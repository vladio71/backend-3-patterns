// Три черги BullMQ: events (з outbox), notifications (email), notifications-dlq (листи, які не вдалося надіслати 3 рази).
import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AppConfig, CONFIG } from '../../common/config';

export const EVENTS_QUEUE = 'events';
export const NOTIFICATIONS_QUEUE = 'notifications';
export const NOTIFICATIONS_DLQ = 'notifications-dlq';

export const QUEUES = 'QUEUES';

export type Queues = { events: Queue; notifications: Queue; notificationsDlq: Queue };

export function queueConnection(config: AppConfig): { host: string; port: number; db: number } {
  return { host: config.redis.host, port: config.redis.port, db: config.redis.db };
}

@Global()
@Module({
  providers: [
    {
      provide: QUEUES,
      inject: [CONFIG],
      useFactory: (config: AppConfig): Queues => {
        const connection = queueConnection(config);
        return {
          events: new Queue(EVENTS_QUEUE, { connection }),
          notifications: new Queue(NOTIFICATIONS_QUEUE, { connection }),
          notificationsDlq: new Queue(NOTIFICATIONS_DLQ, { connection }),
        };
      },
    },
  ],
  exports: [QUEUES],
})
export class QueuesModule implements OnModuleDestroy {
  constructor(@Inject(QUEUES) private readonly queues: Queues) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.queues.events.close(), this.queues.notifications.close(), this.queues.notificationsDlq.close()]);
  }
}
