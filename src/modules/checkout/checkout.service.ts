// Саґа оформлення: reserve_stock -> charge_payment -> create_shipment.
// Стан кожного кроку в таблиці checkout_sagas. Падіння кроку запускає компенсації у зворотному порядку.
// Падіння процесу лишає saga у статусі running, і SagaResumer (worker) продовжує її з saga.step.
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ApiError, notFound } from '../../common/errors';
import { RequestContext } from '../../common/request-context';
import { Order } from '../orders/order.entity';
import { OrderItemDto } from '../orders/orders.dto';
import { OrdersService } from '../orders/orders.service';
import { OutboxService } from '../outbox/outbox.service';
import { PaymentClient } from '../payments/payment.client';
import { Payment } from '../payments/payment.entity';
import { PaymentDeclinedError } from '../payments/fake-payment.provider';
import { Product } from '../products/product.entity';
import { CheckoutSaga, SagaStep } from './checkout-saga.entity';
import { Shipment } from './shipment.entity';

export class SimulatedCrashError extends ApiError {
  constructor(sagaId: string, step: string) {
    super(HttpStatus.INTERNAL_SERVER_ERROR, 'SIMULATED_CRASH', `Імітація падіння процесу після кроку ${step}`, { sagaId, step });
  }
}

export type CheckoutResult = { sagaId: string; orderId: string; status: string; step: string; shipmentId: string | null };

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ctx: RequestContext,
    private readonly orders: OrdersService,
    private readonly payments: PaymentClient,
    private readonly outbox: OutboxService,
  ) {}

  async checkout(items: OrderItemDto[], address: string, failPayment: boolean, crashAfter: string | null): Promise<CheckoutResult> {
    const order = await this.orders.create(items);
    const saga = await this.dataSource.getRepository(CheckoutSaga).save(
      this.dataSource.getRepository(CheckoutSaga).create({
        tenantId: order.tenantId,
        orderId: order.id,
        step: 'reserve_stock',
        status: 'running',
        compensationsDone: [],
        payload: {
          items: order.items.map((i) => ({ productId: i.productId, qty: i.qty, priceCents: i.priceCents })),
          address, amountCents: order.totalCents, failPayment, paymentRef: null, shipmentId: null,
        },
      }),
    );
    return this.run(saga, crashAfter);
  }

  async getSaga(id: string): Promise<CheckoutSaga> {
    const saga = await this.dataSource.getRepository(CheckoutSaga).findOne({ where: { id, tenantId: this.ctx.tenantIdOrFail() } });
    if (!saga) throw notFound('Саґа');
    return saga;
  }

  /** Виконує кроки, починаючи з saga.step. Викликається і з HTTP, і з worker-а (resume). */
  async run(saga: CheckoutSaga, crashAfter: string | null = null): Promise<CheckoutResult> {
    const repo = this.dataSource.getRepository(CheckoutSaga);
    try {
      while (saga.step !== 'done') {
        const current: SagaStep = saga.step;
        await this.executeStep(saga, current);
        saga.step = nextStep(current);
        await repo.save(saga);
        if (crashAfter === current) throw new SimulatedCrashError(saga.id, current);
      }
      saga.status = 'completed';
      await repo.save(saga);
      return this.view(saga);
    } catch (error) {
      if (error instanceof SimulatedCrashError) throw error; // саґа лишається running: її підхопить worker
      this.logger.warn(`Саґа ${saga.id}: крок ${saga.step} упав: ${(error as Error).message}`);
      saga.status = 'compensating';
      saga.error = (error as Error).message;
      await repo.save(saga);
      await this.compensate(saga);
      throw new ApiError(statusFor(error), 'CHECKOUT_FAILED', `Оформлення не вдалося на кроці ${saga.step}: ${saga.error}`, {
        sagaId: saga.id, orderId: saga.orderId, step: saga.step,
      });
    }
  }

  private async executeStep(saga: CheckoutSaga, step: SagaStep): Promise<void> {
    switch (step) {
      case 'reserve_stock': return this.reserveStock(saga);
      case 'charge_payment': return this.chargePayment(saga);
      case 'create_shipment': return this.createShipment(saga);
      case 'done': return;
    }
  }

  /** Крок 1. Кожен товар під FOR UPDATE: два паралельних checkout не продадуть останню одиницю двічі. */
  private async reserveStock(saga: CheckoutSaga): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      for (const item of saga.payload.items) {
        const product = await manager.findOne(Product, { where: { id: item.productId, tenantId: saga.tenantId }, lock: { mode: 'pessimistic_write' } });
        if (!product) throw new Error(`Товар ${item.productId} не знайдено`);
        if (product.stock < item.qty) throw new Error(`Недостатньо товару ${product.sku}: є ${product.stock}, треба ${item.qty}`);
        product.stock -= item.qty;
        await manager.save(Product, product); // save, а не update: так спрацює audit-підписник
      }
    });
  }

  /** Крок 2. Списання через PaymentClient (breaker). Успіх: рядок платежу, замовлення paid, подія order.paid. */
  private async chargePayment(saga: CheckoutSaga): Promise<void> {
    if (saga.payload.paymentRef) return; // уже списано до падіння процесу
    const { paymentRef } = await this.payments.charge(saga.orderId, saga.payload.amountCents, saga.payload.failPayment);
    saga.payload = { ...saga.payload, paymentRef };
    await this.dataSource.transaction(async (manager) => {
      await manager.save(CheckoutSaga, saga);
      await manager.save(Payment, manager.create(Payment, {
        tenantId: saga.tenantId, orderId: saga.orderId, providerRef: paymentRef, amountCents: saga.payload.amountCents, status: 'charged',
      }));
      await this.setOrderStatus(manager, saga, 'paid');
    });
  }

  /** Крок 3. Відправлення. */
  private async createShipment(saga: CheckoutSaga): Promise<void> {
    if (saga.payload.shipmentId) return;
    await this.dataSource.transaction(async (manager) => {
      const shipment = await manager.save(Shipment, manager.create(Shipment, { tenantId: saga.tenantId, orderId: saga.orderId, address: saga.payload.address }));
      saga.payload = { ...saga.payload, shipmentId: shipment.id };
      await manager.save(CheckoutSaga, saga);
      await this.setOrderStatus(manager, saga, 'shipped');
    });
  }

  /** Компенсації у зворотному порядку. Кожна записується в compensations_done, тому повторний виклик нічого не робить двічі. */
  async compensate(saga: CheckoutSaga): Promise<void> {
    if (saga.payload.paymentRef && !saga.compensationsDone.includes('refund')) {
      await this.payments.refund(saga.payload.paymentRef);
      await this.dataSource.transaction(async (manager) => {
        await manager.update(Payment, { providerRef: saga.payload.paymentRef as string }, { status: 'refunded' });
        saga.compensationsDone = [...saga.compensationsDone, 'refund'];
        await manager.save(CheckoutSaga, saga);
      });
    }

    const stockWasReserved = saga.step !== 'reserve_stock';
    if (stockWasReserved && !saga.compensationsDone.includes('release_stock')) {
      await this.dataSource.transaction(async (manager) => {
        for (const item of saga.payload.items) {
          const product = await manager.findOne(Product, { where: { id: item.productId, tenantId: saga.tenantId }, lock: { mode: 'pessimistic_write' } });
          if (!product) continue;
          product.stock += item.qty;
          await manager.save(Product, product);
        }
        saga.compensationsDone = [...saga.compensationsDone, 'release_stock'];
        await manager.save(CheckoutSaga, saga);
      });
    }

    await this.dataSource.transaction(async (manager) => {
      await this.setOrderStatus(manager, saga, 'cancelled');
      saga.status = 'compensated';
      await manager.save(CheckoutSaga, saga);
    });
  }

  private async setOrderStatus(manager: EntityManager, saga: CheckoutSaga, status: Order['status']): Promise<void> {
    const order = await manager.findOne(Order, { where: { id: saga.orderId }, lock: { mode: 'pessimistic_write' } });
    if (!order || order.status === status) return;
    order.status = status;
    await manager.save(Order, order);
    if (status === 'paid') await this.outbox.append(manager, 'order.paid', saga.tenantId, { orderId: order.id, userId: order.userId, amountCents: saga.payload.amountCents });
    if (status === 'cancelled') await this.outbox.append(manager, 'order.cancelled', saga.tenantId, { orderId: order.id, userId: order.userId });
  }

  private view(saga: CheckoutSaga): CheckoutResult {
    return { sagaId: saga.id, orderId: saga.orderId, status: saga.status, step: saga.step, shipmentId: saga.payload.shipmentId };
  }
}

function nextStep(step: SagaStep): SagaStep {
  switch (step) {
    case 'reserve_stock': return 'charge_payment';
    case 'charge_payment': return 'create_shipment';
    default: return 'done';
  }
}

function statusFor(error: unknown): HttpStatus {
  if (error instanceof HttpException) return error.getStatus(); // 503 від PaymentClient
  if (error instanceof PaymentDeclinedError) return HttpStatus.PAYMENT_REQUIRED;
  return HttpStatus.CONFLICT; // напр. недостатньо товару
}
