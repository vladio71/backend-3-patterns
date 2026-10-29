// Точка входу API. rawBody: true потрібен для перевірки HMAC-підпису вебхука над сирим тілом.
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { CONFIG, AppConfig } from './common/config';
import { setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  setupApp(app);
  app.enableShutdownHooks();
  const config = app.get<AppConfig>(CONFIG);
  await app.listen(config.port);
  new Logger('Bootstrap').log(`API на http://localhost:${config.port}, довідка /reference, черги /queues`);
}

void bootstrap();
