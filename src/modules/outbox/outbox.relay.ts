// Relay: раз на секунду бере до 50 неопублікованих подій (FOR UPDATE SKIP LOCKED), кладе їх у чергу
// і позначає published_at. Якщо процес упаде посередині, транзакція відкотиться і рядок лишиться неопублікованим.
// Лічильник attempts рахує НЕВДАЛІ публікації. Його не можна збільшувати в тій самій транзакції (вона відкотиться разом
// із помилкою), тому після відкату він росте окремим коротким UPDATE.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppConfig, CONFIG } from '../../common/config';
import { QUEUES, Queues } from '../queues/queues.module';
import { OutboxEvent } from './outbox-event.entity';

export type OutboxJobData = { eventId: string; type: string; tenantId: string; payload: Record<string, unknown> };

@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  /** Тільки для тестів: наступна публікація кине помилку (імітація падіння relay між INSERT і publish). */
  failNextPublish = false;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(QUEUES) private readonly queues: Queues,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((e) => this.logger.error(`tick: ${String(e)}`)), this.config.outbox.pollMs);
    this.logger.log(`Relay запущено, poll кожні ${this.config.outbox.pollMs} мс`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Один прохід. Повертає кількість опублікованих подій. */
  async tick(): Promise<number> {
    if (this.running) return 0; // попередній tick ще працює
    this.running = true;
    let currentId: string | null = null; // подія, на якій транзакція впала
    try {
      return await this.dataSource.transaction(async (manager) => {
        const events = await manager
          .getRepository(OutboxEvent)
          .createQueryBuilder('e')
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked') // другий інстанс worker не чекає, а бере інші рядки
          .where('e.published_at IS NULL')
          .orderBy('e.created_at', 'ASC')
          .limit(this.config.outbox.batchSize)
          .getMany();

        if (events.length === 0) return 0;

        for (const event of events) {
          currentId = event.id;
          if (this.failNextPublish) {
            this.failNextPublish = false;
            throw new Error('Імітація падіння relay перед publish');
          }
          const data: OutboxJobData = { eventId: event.id, type: event.type, tenantId: event.tenantId, payload: event.payload };
          // jobId = id події: якщо relay встиг опублікувати, але не встиг закомітити, повторний add буде no-op.
          await this.queues.events.add(event.type, data, { jobId: event.id, removeOnComplete: 1000, removeOnFail: 1000 });
          event.publishedAt = new Date();
          await manager.save(OutboxEvent, event);
        }
        return events.length;
      });
    } catch (error) {
      if (currentId) await this.countFailure(currentId);
      throw error;
    } finally {
      this.running = false;
    }
  }

  /** Окрема коротка транзакція (автокоміт): основна вже відкотилась, а лічильник має пережити відкат. */
  private async countFailure(eventId: string): Promise<void> {
    try {
      await this.dataSource.getRepository(OutboxEvent).increment({ id: eventId }, 'attempts', 1);
    } catch (error) {
      this.logger.error(`Не вдалося збільшити attempts для події ${eventId}: ${String(error)}`);
    }
  }
}
