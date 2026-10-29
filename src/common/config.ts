// Конфіг читаємо з process.env один раз і віддаємо як простий об'єкт.
// Жодної магії: кожна змінна описана в .env.example.

export type BreakerImpl = 'opossum' | 'custom';
export type StorageDriver = 's3' | 'fake';

export type AppConfig = {
  port: number;
  jwtSecret: string;
  webhookSecret: string;
  db: { host: string; port: number; user: string; password: string; name: string; logging: boolean };
  redis: { host: string; port: number; db: number };
  breaker: { impl: BreakerImpl; failureThreshold: number; windowMs: number; resetMs: number; callTimeoutMs: number };
  storage: {
    driver: StorageDriver;
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    maxImageBytes: number;
  };
  flags: { cacheTtlSec: number };
  notifications: { attempts: number; backoffMs: number };
  outbox: { pollMs: number; batchSize: number };
  saga: { resumeAfterMs: number; resumePollMs: number };
};

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function num(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) throw new Error(`Змінна ${name} має бути числом, отримано "${value}"`);
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

export function loadConfig(): AppConfig {
  const breakerImpl = str('BREAKER_IMPL', 'opossum');
  if (breakerImpl !== 'opossum' && breakerImpl !== 'custom') {
    throw new Error('BREAKER_IMPL має бути opossum або custom');
  }
  const storageDriver = str('STORAGE_DRIVER', 's3');
  if (storageDriver !== 's3' && storageDriver !== 'fake') {
    throw new Error('STORAGE_DRIVER має бути s3 або fake');
  }
  return {
    port: num('PORT', 3002),
    jwtSecret: str('JWT_SECRET', 'dev-secret-change-me'),
    webhookSecret: str('PAYMENT_WEBHOOK_SECRET', 'whsec-dev'),
    db: {
      host: str('DB_HOST', 'localhost'),
      port: num('DB_PORT', 5432),
      user: str('DB_USER', 'patterns'),
      password: str('DB_PASSWORD', 'patterns'),
      name: str('DB_NAME', 'patterns'),
      logging: bool('DB_LOGGING', false),
    },
    redis: { host: str('REDIS_HOST', 'localhost'), port: num('REDIS_PORT', 6379), db: num('REDIS_DB', 0) },
    breaker: {
      impl: breakerImpl,
      failureThreshold: num('BREAKER_FAILURE_THRESHOLD', 5),
      windowMs: num('BREAKER_WINDOW_MS', 10_000),
      resetMs: num('BREAKER_RESET_MS', 30_000),
      callTimeoutMs: num('BREAKER_CALL_TIMEOUT_MS', 2_000),
    },
    storage: {
      driver: storageDriver,
      endpoint: str('S3_ENDPOINT', 'http://localhost:9000'),
      region: str('S3_REGION', 'us-east-1'),
      bucket: str('S3_BUCKET', 'product-images'),
      accessKeyId: str('S3_ACCESS_KEY_ID', 'minioadmin'),
      secretAccessKey: str('S3_SECRET_ACCESS_KEY', 'minioadmin'),
      forcePathStyle: bool('S3_FORCE_PATH_STYLE', true),
      maxImageBytes: num('MAX_IMAGE_BYTES', 2 * 1024 * 1024),
    },
    flags: { cacheTtlSec: num('FLAGS_CACHE_TTL_SEC', 10) },
    notifications: { attempts: num('EMAIL_ATTEMPTS', 3), backoffMs: num('EMAIL_BACKOFF_MS', 1000) },
    outbox: { pollMs: num('OUTBOX_POLL_MS', 1000), batchSize: num('OUTBOX_BATCH_SIZE', 50) },
    saga: { resumeAfterMs: num('SAGA_RESUME_AFTER_MS', 30_000), resumePollMs: num('SAGA_RESUME_POLL_MS', 5_000) },
  };
}

export const CONFIG = 'CONFIG';
