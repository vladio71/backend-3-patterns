// Постановка листа в чергу notifications. 3 спроби з експоненційним backoff, далі DLQ (див. email.worker.ts).
import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AppConfig, CONFIG } from '../../common/config';
import { QUEUES, Queues } from '../queues/queues.module';
import { User } from '../auth/user.entity';

export type EmailJobData = { to: string; subject: string; body: string; orderId: string | null; eventId: string | null };

@Injectable()
export class NotificationsService {
  constructor(@Inject(QUEUES) private readonly queues: Queues, @Inject(CONFIG) private readonly config: AppConfig) {}

  async enqueueOrderPaidEmail(manager: EntityManager, eventId: string, payload: Record<string, unknown>): Promise<void> {
    const userId = typeof payload.userId === 'string' ? payload.userId : null;
    const orderId = typeof payload.orderId === 'string' ? payload.orderId : null;
    const user = userId ? await manager.findOne(User, { where: { id: userId } }) : null;
    await this.enqueue({
      to: user?.email ?? 'unknown@example.com',
      subject: `Замовлення ${orderId ?? ''} оплачено`,
      body: `Дякуємо! Замовлення ${orderId ?? ''} оплачено, готуємо відправлення.`,
      orderId,
      eventId,
    }, `email-${eventId}`); // jobId від події: повторна доставка тієї самої події не створить другого листа
  }

  async enqueue(data: EmailJobData, jobId: string): Promise<void> {
    await this.queues.notifications.add('email', data, {
      jobId,
      attempts: this.config.notifications.attempts,
      backoff: { type: 'exponential', delay: this.config.notifications.backoffMs },
      removeOnComplete: 1000,
      removeOnFail: false, // лишаємо, щоб Bull Board показував історію
    });
  }
}
