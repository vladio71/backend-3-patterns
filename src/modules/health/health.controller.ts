import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators';
import { REDIS } from '../../common/redis.provider';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource, @Inject(REDIS) private readonly redis: Redis) {}

  @Public()
  @Get()
  async check(): Promise<{ ok: boolean; db: boolean; redis: boolean }> {
    const db = await this.dataSource.query('SELECT 1').then(() => true, () => false);
    const redis = await this.redis.ping().then((pong) => pong === 'PONG', () => false);
    return { ok: db && redis, db, redis };
  }
}
