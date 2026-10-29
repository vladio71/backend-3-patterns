// Налаштування Nest-застосунку, спільне для main.ts і e2e-тестів: helmet, версіонування, Scalar, Bull Board.
import { INestApplication, Logger, VersioningType, VERSION_NEUTRAL } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import helmet from 'helmet';
import { QUEUES, Queues } from './modules/queues/queues.module';

export function setupApp(app: NestExpressApplication): void {
  app.use(helmet({ contentSecurityPolicy: false })); // CSP вимкнено заради Scalar і Bull Board
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_NEUTRAL });
  setupDocs(app);
  setupBullBoard(app);
}

function setupDocs(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Shop patterns API')
    .setDescription('12 продакшн-патернів на одному магазині. Повний список у docs/ENDPOINTS.md.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  try {
    // Scalar: сучасна довідка на /reference. Якщо пакет не піднявся, нижче є Swagger UI на /docs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { apiReference } = require('@scalar/nestjs-api-reference') as { apiReference: (options: { content: unknown }) => unknown };
    app.use('/reference', apiReference({ content: document }));
  } catch (error) {
    new Logger('Docs').warn(`Scalar не піднявся (${(error as Error).message}), лишається Swagger UI на /docs`);
  }
  SwaggerModule.setup('docs', app, document);
}

function setupBullBoard(app: INestApplication): void {
  const queues = app.get<Queues>(QUEUES);
  const adapter = new ExpressAdapter();
  adapter.setBasePath('/queues');
  createBullBoard({
    queues: [new BullMQAdapter(queues.events), new BullMQAdapter(queues.notifications), new BullMQAdapter(queues.notificationsDlq)],
    serverAdapter: adapter,
  });
  app.use('/queues', adapter.getRouter());
}
