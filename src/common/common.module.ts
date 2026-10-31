// Глобальний модуль: конфіг, контекст запиту, Redis. Імпортується один раз в AppModule і WorkerModule.
import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { CONFIG, loadConfig } from './config';
import { RequestContext } from './request-context';
import { FLAGS_REDIS, REDIS, flagsRedisProvider, redisProvider } from './redis.provider';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: loadConfig }, RequestContext, redisProvider, flagsRedisProvider],
  exports: [CONFIG, RequestContext, redisProvider, flagsRedisProvider],
})
export class CommonModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis, @Inject(FLAGS_REDIS) private readonly flagsRedis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    for (const client of [this.redis, this.flagsRedis]) {
      if (client.status !== 'end') await client.quit().catch(() => client.disconnect());
    }
  }
}
