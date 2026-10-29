// Точка входу worker-а: relay outbox, споживач events, worker листів, resumer саґ. Без HTTP.
// Перший import: трейсинг має запатчити pg/ioredis до того, як їх завантажить Nest (див. src/tracing.ts).
import './tracing';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SagaResumer } from './modules/checkout/saga-resumer';
import { EmailWorker } from './modules/notifications/email.worker';
import { EventsConsumer } from './modules/outbox/events.consumer';
import { OutboxRelay } from './modules/outbox/outbox.relay';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // Без enableShutdownHooks: сигнали обробляємо самі нижче, щоб спочатку зупинити worker-и, а потім закрити з'єднання.
  const relay = app.get(OutboxRelay);
  const consumer = app.get(EventsConsumer);
  const email = app.get(EmailWorker);
  const resumer = app.get(SagaResumer);
  relay.start();
  consumer.start();
  email.start();
  resumer.start();
  new Logger('Worker').log('Worker запущено');

  const shutdown = async (): Promise<void> => {
    relay.stop();
    resumer.stop();
    await consumer.stop();
    await email.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void bootstrap();
