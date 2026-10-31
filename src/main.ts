// Точка входу API. rawBody: true потрібен для перевірки HMAC-підпису вебхука над сирим тілом.
// Перший import: трейсинг має запатчити http/express/pg/ioredis до того, як їх завантажить Nest (див. src/tracing.ts).
import './tracing';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { CONFIG, AppConfig } from './common/config';
import { setupApp } from './setup-app';
import { join } from 'node:path';
import type { Request, Response } from 'express';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  setupApp(app);
  // GET /scheme: схема проєкту (Excalidraw у режимі перегляду), файли з папки public (dist/src -> ../../public).
  const publicDir = join(__dirname, '..', '..', 'public');
  app.useStaticAssets(publicDir);
  app.getHttpAdapter().get('/scheme', (_req: Request, res: Response) => {
    res.sendFile(join(publicDir, 'scheme.html'));
  });
  app.enableShutdownHooks();
  const config = app.get<AppConfig>(CONFIG);
  await app.listen(config.port);
  new Logger('Bootstrap').log(`API на http://localhost:${config.port}, довідка /reference, черги /queues, схема /scheme`);
}

void bootstrap();
