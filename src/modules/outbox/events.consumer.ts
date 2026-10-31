// Споживач черги events. Ідемпотентний: event id вставляється в consumed_events, повторна доставка тієї самої події
// падає на первинному ключі, і ефект не повторюється.
//
// Увага: ефект order.paid це queue.add у Redis, а не запис у Postgres, тому в одну транзакцію з consumed_events він
// НЕ входить. Якщо add пройшов, а COMMIT упав, подію доставлять ще раз і add повториться. Від другого листа рятує
// jobId = email-<eventId> (BullMQ ігнорує add з id, який уже є). Тобто гарантія "один лист" складається з двох частин:
// consumed_events відсікає повторну доставку, jobId відсікає повторний add, коли consumed_events відкотився.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { DataSource } from 'typeorm';
import { AppConfig, CONFIG } from '../../common/config';
import { isUniqueViolation } from '../../common/errors';
import { NotificationsService } from '../notifications/notifications.service';
import { EVENTS_QUEUE, queueConnection } from '../queues/queues.module';
import { ConsumedEvent } from './consumed-event.entity';
import { OutboxJobData } from './outbox.relay';

@Injectable()
export class EventsConsumer {
  private readonly logger = new Logger(EventsConsumer.name);
  private worker: Worker | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  start(): void {
    if (this.worker) return;
    this.worker = new Worker<OutboxJobData>(EVENTS_QUEUE, (job) => this.handle(job), { connection: queueConnection(this.config), concurrency: 4 });
    this.worker.on('failed', (job, error) => this.logger.warn(`Подія ${job?.data.eventId} не оброблена: ${error.message}`));
    this.logger.log('Споживач events запущено');
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }

  /** Повертає true, якщо ефект застосовано, і false, якщо подія вже була оброблена. */
  async handle(job: Job<OutboxJobData>): Promise<boolean> {
    const { eventId, type, tenantId, payload } = job.data;
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.insert(ConsumedEvent, { eventId, type, effect: this.effectName(type) });
        // add кидає помилку -> транзакція відкотиться, подію доставлять знову. add пройшов, а COMMIT упав -> jobId (див. вгорі).
        if (type === 'order.paid') {
          await this.notifications.enqueueOrderPaidEmail(manager, eventId, tenantId, payload);
        }
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.log(`Подія ${eventId} вже оброблена, пропускаємо`);
        return false;
      }
      throw error;
    }
  }

  private effectName(type: string): string {
    return type === 'order.paid' ? 'enqueue_email' : 'log';
  }
}
