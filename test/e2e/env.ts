// Змінні середовища для e2e. У CI це сервіси postgres/redis на стандартних портах, локально можна перевизначити TEST_*.
process.env.DB_HOST = process.env.TEST_DB_HOST ?? process.env.DB_HOST ?? '127.0.0.1';
process.env.DB_PORT = process.env.TEST_DB_PORT ?? process.env.DB_PORT ?? '5432';
process.env.DB_USER = process.env.TEST_DB_USER ?? process.env.DB_USER ?? 'patterns';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD ?? process.env.DB_PASSWORD ?? 'patterns';
process.env.DB_NAME = process.env.TEST_DB_NAME ?? 'patterns_test';
process.env.REDIS_HOST = process.env.TEST_REDIS_HOST ?? process.env.REDIS_HOST ?? '127.0.0.1';
process.env.REDIS_PORT = process.env.TEST_REDIS_PORT ?? process.env.REDIS_PORT ?? '6379';
process.env.REDIS_DB = process.env.TEST_REDIS_DB ?? '1'; // окрема БД Redis: тести не ділять черги з запущеним worker-ом
process.env.STORAGE_DRIVER = 'fake';
process.env.JWT_SECRET = 'test-secret';
process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.OUTBOX_POLL_MS = '200';
process.env.EMAIL_BACKOFF_MS = '50';
process.env.SAGA_RESUME_AFTER_MS = '0';
process.env.FLAGS_CACHE_TTL_SEC = '10';
process.env.S3_PRESIGN_EXPIRES_SEC = '120';
