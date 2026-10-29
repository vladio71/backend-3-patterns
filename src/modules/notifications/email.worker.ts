// Worker черги notifications. Після вичерпання спроб (3) копіює job у notifications-dlq, щоб лист не загубився.
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
    this.worker.on('failed', (job, error) => void this.onFailed(job, error));
    this.logger.log('Worker notifications запущено');
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }

  async handle(job: Job<EmailJobData>): Promise<void> {
    await this.email.send({ to: job.data.to, subject: job.data.subject, body: job.data.body }, job.id ?? null);
  }

  private async onFailed(job: Job<EmailJobData> | undefined, error: Error): Promise<void> {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      this.logger.warn(`Лист ${job.id}: спроба ${job.attemptsMade}/${maxAttempts} не вдалася, повтор пізніше`);
      return;
    }
    this.logger.error(`Лист ${job.id}: усі ${maxAttempts} спроби вичерпано, переносимо в DLQ`);
    await this.queues.notificationsDlq.add('email', { ...job.data, failedReason: error.message, attempts: job.attemptsMade }, { jobId: `dlq-${job.id}` });
  }
}
