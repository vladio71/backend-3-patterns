// Клієнти ioredis на процес. BullMQ створює власні з'єднання з тих самих host/port.
// REDIS: загальний клієнт (демо-перемикачі, health). maxRetriesPerRequest: null означає "чекати Redis скільки треба".
// FLAGS_REDIS: клієнт кешу прапорців. Прапорці стоять на гарячому шляху запиту (GET /products), тому тут навпаки:
// якщо Redis лежить, команда має впасти за долі секунди, а не висіти (за замовчуванням ioredis повторює до 20 разів).
import { Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig, CONFIG } from './config';

export const REDIS = 'REDIS';
export const FLAGS_REDIS = 'FLAGS_REDIS';

/** Скільки разів ioredis перепробує команду, перш ніж її відхилити. */
export const FLAGS_REDIS_MAX_RETRIES = 1;

export const redisProvider: Provider = {
  provide: REDIS,
  inject: [CONFIG],
  useFactory: (config: AppConfig): Redis => new Redis({ host: config.redis.host, port: config.redis.port, db: config.redis.db, maxRetriesPerRequest: null }),
};

export const flagsRedisProvider: Provider = {
  provide: FLAGS_REDIS,
  inject: [CONFIG],
  useFactory: (config: AppConfig): Redis =>
    new Redis({ host: config.redis.host, port: config.redis.port, db: config.redis.db, maxRetriesPerRequest: FLAGS_REDIS_MAX_RETRIES, connectTimeout: 1000 }),
};
