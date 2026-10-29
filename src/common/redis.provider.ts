// Один клієнт ioredis на процес. BullMQ створює власні з'єднання з тих самих host/port.
import { Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig, CONFIG } from './config';

export const REDIS = 'REDIS';

export const redisProvider: Provider = {
  provide: REDIS,
  inject: [CONFIG],
  useFactory: (config: AppConfig): Redis => new Redis({ host: config.redis.host, port: config.redis.port, db: config.redis.db, maxRetriesPerRequest: null }),
};
