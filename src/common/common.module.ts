// Глобальний модуль: конфіг, контекст запиту, Redis. Імпортується один раз в AppModule і WorkerModule.
import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { CONFIG, loadConfig } from './config';
import { RequestContext } from './request-context';
import { REDIS, redisProvider } from './redis.provider';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: loadConfig }, RequestContext, redisProvider],
  exports: [CONFIG, RequestContext, redisProvider],
})
export class CommonModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status !== 'end') await this.redis.quit();
  }
}
