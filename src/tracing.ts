// Що це: вмикає OpenTelemetry-трейсинг і відправку span-ів у Jaeger (або будь-який OTLP-колектор).
// Чому окремий файл і перший import у main.ts і worker.ts: авто-інструментації патчать модулі http, express, pg, ioredis
// у момент їхнього require. Якщо Nest встигне завантажити їх раніше, span-ів не буде.
// Коли вимкнено: без OTEL_EXPORTER_OTLP_ENDPOINT цей файл нічого не робить, а @opentelemetry/api працює як no-op
// (propagation.inject не пише нічого, startActiveSpan створює span, який нікуди не йде). Тести і dev без Jaeger не помічають різниці.
// Хто викликає: import './tracing' у src/main.ts і src/worker.ts. Документація: docs/tracing.md.
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { setGlobalErrorHandler } from '@opentelemetry/core';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  // Лише ті інструментації, які нам потрібні: http (вхідні і вихідні запити), express (роутинг і middleware),
  // pg (кожен SQL-запит як span), ioredis (кожна Redis-команда). Решта (fs, dns, net) лише шумить.
  process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS ??= 'http,express,pg,ioredis';
  // Тільки трейси. Без цього NodeSDK за замовчуванням ще й шле метрики і логи на той самий endpoint,
  // а Jaeger їх не приймає (404 кожну хвилину).
  process.env.OTEL_METRICS_EXPORTER ??= 'none';
  process.env.OTEL_LOGS_EXPORTER ??= 'none';

  // Внутрішні повідомлення SDK: тільки попередження і помилки, у stderr.
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

  // Jaeger недоступний: експортер падає на кожному batch-і (кожні 5 с). Пишемо це один раз, а не щоразу,
  // і НЕ зупиняємо застосунок: трейсинг це допоміжна річ, без нього API має працювати як і раніше.
  let exportErrorLogged = false;
  setGlobalErrorHandler((error: unknown) => {
    if (exportErrorLogged) return;
    exportErrorLogged = true;
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[tracing] не вдалося відправити span-и на ${endpoint}: ${message}. Наступні помилки експорту не логуються.\n`);
  });

  const sdk = new NodeSDK({
    // Ім'я сервісу в Jaeger: OTEL_SERVICE_NAME (api або worker у docker-compose), інакше patterns.
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'patterns',
    // Куди слати: OTLP/HTTP, url береться з OTEL_EXPORTER_OTLP_ENDPOINT + /v1/traces.
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
  process.stdout.write(`[tracing] увімкнено, span-и йдуть на ${endpoint}\n`);

  // На зупинці дочекатися, поки останній batch span-ів піде у Jaeger (інакше хвіст трейсу губиться).
  const shutdown = (): void => {
    sdk.shutdown().catch(() => undefined);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
