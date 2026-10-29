// Клієнт провайдера за circuit breaker-ом. BREAKER_IMPL=opossum (бібліотека) або custom (src/common/circuit-breaker.ts).
// Коли breaker відкритий, виклик падає одразу з PaymentUnavailableError (503), а не чекає таймаут.
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import OpossumBreaker from 'opossum';
import { AppConfig, CONFIG } from '../../common/config';
import { BreakerState, CircuitBreaker, CircuitOpenError } from '../../common/circuit-breaker';
import { ApiError } from '../../common/errors';
import { FakePaymentProvider, PaymentDeclinedError } from './fake-payment.provider';

export class PaymentUnavailableError extends ApiError {
  constructor() {
    super(HttpStatus.SERVICE_UNAVAILABLE, 'PAYMENT_UNAVAILABLE', 'Платіжний провайдер тимчасово недоступний');
  }
}

/** Провайдер відповів помилкою або не відповів у таймаут: breaker це порахував, клієнт отримує 503. */
export class PaymentProviderError extends ApiError {
  constructor(message: string) {
    super(HttpStatus.SERVICE_UNAVAILABLE, 'PAYMENT_PROVIDER_ERROR', message);
  }
}

export type BreakerView = { impl: string; state: BreakerState; failures: number };

type ChargeArgs = { orderId: string; amountCents: number; forceDecline: boolean };

@Injectable()
export class PaymentClient {
  private readonly logger = new Logger(PaymentClient.name);
  private readonly custom: CircuitBreaker | null = null;
  private readonly opossum: OpossumBreaker<[ChargeArgs], { paymentRef: string }> | null = null;

  constructor(private readonly provider: FakePaymentProvider, @Inject(CONFIG) private readonly config: AppConfig) {
    const b = config.breaker;
    const isDecline = (error: unknown): boolean => error instanceof PaymentDeclinedError;

    if (b.impl === 'custom') {
      this.custom = new CircuitBreaker({
        failureThreshold: b.failureThreshold, windowMs: b.windowMs, resetMs: b.resetMs, callTimeoutMs: b.callTimeoutMs, ignoreError: isDecline,
      });
    } else {
      this.opossum = new OpossumBreaker((args: ChargeArgs) => this.provider.charge(args.orderId, args.amountCents, args.forceDecline), {
        timeout: b.callTimeoutMs,
        rollingCountTimeout: b.windowMs,   // вікно статистики
        rollingCountBuckets: 10,
        volumeThreshold: b.failureThreshold, // менше 5 викликів у вікні: не відкриваємо
        errorThresholdPercentage: 50,        // opossum рахує відсоток помилок, а не штуки
        resetTimeout: b.resetMs,
        errorFilter: isDecline,
      });
      this.opossum.on('open', () => this.logger.warn('Breaker: open'));
      this.opossum.on('halfOpen', () => this.logger.warn('Breaker: half-open'));
      this.opossum.on('close', () => this.logger.log('Breaker: closed'));
    }
  }

  async charge(orderId: string, amountCents: number, forceDecline: boolean): Promise<{ paymentRef: string }> {
    const args: ChargeArgs = { orderId, amountCents, forceDecline };
    try {
      if (this.custom) return await this.custom.exec(() => this.provider.charge(orderId, amountCents, forceDecline));
      return await this.opossum!.fire(args);
    } catch (error) {
      if (error instanceof CircuitOpenError || isOpossumOpen(error)) throw new PaymentUnavailableError();
      if (error instanceof PaymentDeclinedError) throw error;
      throw new PaymentProviderError((error as Error).message);
    }
  }

  /** Повернення коштів іде повз breaker: компенсацію саґи не можна блокувати. */
  refund(paymentRef: string): Promise<{ refundRef: string }> {
    return this.provider.refund(paymentRef);
  }

  state(): BreakerView {
    if (this.custom) return { impl: 'custom', state: this.custom.state(), failures: this.custom.failureCount() };
    const o = this.opossum!;
    const state: BreakerState = o.opened ? 'open' : o.halfOpen ? 'half-open' : 'closed';
    return { impl: 'opossum', state, failures: o.stats.failures };
  }
}

function isOpossumOpen(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'EOPENBREAKER';
}
