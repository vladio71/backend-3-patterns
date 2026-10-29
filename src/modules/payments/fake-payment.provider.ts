// Фейковий платіжний провайдер. Стан (failing, latencyMs) у Redis, щоб API і worker бачили одне й те саме.
// Дві різні помилки: ProviderDownError (провайдер лежить, рахується breaker-ом) і PaymentDeclinedError (відмова, не рахується).
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { REDIS } from '../../common/redis.provider';

export const PAYMENT_PROVIDER_KEY = 'demo:payment-provider';

export type ProviderState = { failing: boolean; latencyMs: number };

export class ProviderDownError extends Error {
  constructor() {
    super('Платіжний провайдер повернув 500');
  }
}

export class PaymentDeclinedError extends Error {
  constructor(reason: string) {
    super(`Платіж відхилено: ${reason}`);
  }
}

@Injectable()
export class FakePaymentProvider {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async charge(orderId: string, amountCents: number, forceDecline: boolean): Promise<{ paymentRef: string }> {
    await this.simulate();
    if (amountCents % 100 === 99) throw new PaymentDeclinedError('сума закінчується на .99');
    if (forceDecline) throw new PaymentDeclinedError('заголовок X-Fail-Payment');
    return { paymentRef: `pay_${randomUUID()}` };
  }

  async refund(paymentRef: string): Promise<{ refundRef: string }> {
    await this.simulate();
    return { refundRef: `re_${paymentRef}` };
  }

  async getState(): Promise<ProviderState> {
    const raw = await this.redis.hgetall(PAYMENT_PROVIDER_KEY);
    return { failing: raw.failing === '1', latencyMs: Number(raw.latencyMs ?? 0) };
  }

  async setState(state: ProviderState): Promise<void> {
    await this.redis.hset(PAYMENT_PROVIDER_KEY, { failing: state.failing ? '1' : '0', latencyMs: String(state.latencyMs) });
  }

  private async simulate(): Promise<void> {
    const state = await this.getState();
    if (state.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, state.latencyMs));
    if (state.failing) throw new ProviderDownError();
  }
}
