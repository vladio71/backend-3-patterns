import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators';
import { REDIS } from '../../common/redis.provider';

export type HealthView = { ok: boolean; db: boolean; redis: boolean };

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource, @Inject(REDIS) private readonly redis: Redis) {}

  /**
   * 200, коли база і Redis відповідають, і 503, коли ні (тіло те саме). Статус, а не лише поле ok у тілі,
   * бо його читають healthcheck Docker, балансувальник і Kubernetes: вони дивляться на код відповіді, а не в JSON.
   */
  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthView> {
    const db = await this.dataSource.query('SELECT 1').then(() => true, () => false);
    const redis = await this.redis.ping().then((pong) => pong === 'PONG', () => false);
    const ok = db && redis;
    if (!ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { ok, db, redis };
  }
}
