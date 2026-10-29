// Обробка вебхука "оплата пройшла". Ідемпотентність на первинному ключі processed_webhook_events:
// вставка id події + зміна замовлення + рядок платежу + подія outbox в ОДНІЙ транзакції.
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isUniqueViolation, notFound } from '../../common/errors';
import { Order } from '../orders/order.entity';
import { OutboxService } from '../outbox/outbox.service';
import { Payment } from './payment.entity';
import { PaymentWebhookDto } from './payments.dto';
import { ProcessedWebhookEvent } from './processed-webhook-event.entity';

export type WebhookResult = { duplicate: boolean; orderId: string; status: string };

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly dataSource: DataSource, private readonly outbox: OutboxService) {}

  async handlePaymentSucceeded(dto: PaymentWebhookDto): Promise<WebhookResult> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        // 1. Спочатку "займаємо" id події. Друга доставка впаде тут на 23505 (одразу або після коміту першої).
        await manager.insert(ProcessedWebhookEvent, { eventId: dto.eventId });

        // 2. Замовлення під блокуванням рядка, щоб паралельні зміни (саґа) чекали.
        const order = await manager.findOne(Order, { where: { id: dto.orderId }, lock: { mode: 'pessimistic_write' } });
        if (!order) throw notFound('Замовлення');

        if (order.status === 'pending') {
          order.status = 'paid';
          await manager.save(Order, order); // через save, щоб спрацював audit-підписник

          await manager.save(Payment, manager.create(Payment, {
            tenantId: order.tenantId, orderId: order.id, providerRef: dto.paymentRef ?? dto.eventId, amountCents: dto.amountCents, status: 'charged',
          }));

          await this.outbox.append(manager, 'order.paid', order.tenantId, { orderId: order.id, userId: order.userId, amountCents: dto.amountCents });
        }
        return { duplicate: false, orderId: order.id, status: order.status };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.log(`Повторна доставка події ${dto.eventId}`);
        return { duplicate: true, orderId: dto.orderId, status: 'unchanged' };
      }
      throw error;
    }
  }
}
