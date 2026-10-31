// Worker черги notifications. На останній спробі (3) копіює job у notifications-dlq, щоб лист не загубився.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { AppConfig, CONFIG } from '../../common/config';
import { NOTIFICATIONS_QUEUE, QUEUES, Queues, queueConnection } from '../queues/queues.module';
import { FakeEmailProvider } from './fake-email.provider';
import { EmailJobData } from './notifications.service';

@Injectable()
export class EmailWorker {
  private readonly logger = new Logger(EmailWorker.name);
  private worker: Worker | null = null;

  constructor(
    private readonly email: FakeEmailProvider,
    @Inject(QUEUES) private readonly queues: Queues,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  start(): void {
    if (this.worker) return;
    this.worker = new Worker<EmailJobData>(NOTIFICATIONS_QUEUE, (job) => this.handle(job), { connection: queueConnection(this.config), concurrency: 4 });
    this.logger.log('Worker notifications запущено');
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }

  /**
   * DLQ-копія робиться тут, в обробнику, ПЕРЕД тим як помилка піде в BullMQ, а не в слухачі події `failed`.
   * Слухач стріляє вже після того, як job позначено failed, і лише в тому процесі, що його обробляв: якщо процес
   * помре в цей проміжок, job failed, а в DLQ його немає. Тут порядок інший: спершу копія, потім помилка, тож
   * "failed без копії" неможливий. Зворотний випадок (копія є, а job усе одно піде на повтор після збою) безпечний,
   * бо jobId = dlq-<id> робить повторний add порожньою дією.
   */
  async handle(job: Job<EmailJobData>): Promise<void> {
    try {
      await this.email.send({ to: job.data.to, subject: job.data.subject, body: job.data.body }, job.id ?? null);
    } catch (error) {
      const maxAttempts = job.opts.attempts ?? 1;
      const attempt = job.attemptsMade + 1; // attemptsMade збільшується лише після того, як обробник завершився
      if (attempt >= maxAttempts) {
        this.logger.error(`Лист ${job.id}: усі ${maxAttempts} спроби вичерпано, переносимо в DLQ`);
        await this.queues.notificationsDlq.add(
          'email',
          { ...job.data, failedReason: (error as Error).message, attempts: attempt },
          { jobId: `dlq-${job.id}` },
        );
      } else {
        this.logger.warn(`Лист ${job.id}: спроба ${attempt}/${maxAttempts} не вдалася, повтор пізніше`);
      }
      throw error;
    }
  }
}
