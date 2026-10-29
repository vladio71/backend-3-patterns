// Feature flags: таблиця в Postgres, кеш у Redis на 10 с, детермінований відсотковий rollout.
// Той самий користувач завжди отримує ту саму відповідь для того самого прапорця.
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { AppConfig, CONFIG } from '../../common/config';
import { REDIS } from '../../common/redis.provider';
import { FeatureFlag } from './feature-flag.entity';

export type FlagView = { key: string; enabled: boolean; percentage: number; allowlist: string[] };

/** hash(userId + key) % 100: стабільне число 0..99 для пари користувач+прапорець. */
export function rolloutBucket(userId: string, key: string): number {
  const digest = createHash('sha256').update(`${userId}:${key}`).digest();
  return digest.readUInt32BE(0) % 100;
}

@Injectable()
export class FeatureFlagsService {
  constructor(
    @InjectRepository(FeatureFlag) private readonly flags: Repository<FeatureFlag>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async isOn(key: string, userId: string | null): Promise<boolean> {
    const flag = await this.get(key);
    if (!flag || !flag.enabled) return false;
    if (userId && flag.allowlist.includes(userId)) return true;
    if (flag.percentage >= 100) return true;
    if (flag.percentage <= 0 || !userId) return false;
    return rolloutBucket(userId, key) < flag.percentage;
  }

  async get(key: string): Promise<FlagView | null> {
    const cacheKey = `flags:${key}`;
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) return cached === 'null' ? null : (JSON.parse(cached) as FlagView);

    const row = await this.flags.findOne({ where: { key } });
    const view = row ? toView(row) : null;
    await this.redis.set(cacheKey, JSON.stringify(view), 'EX', this.config.flags.cacheTtlSec);
    return view;
  }

  async list(): Promise<FlagView[]> {
    const rows = await this.flags.find({ order: { key: 'ASC' } });
    return rows.map(toView);
  }

  async upsert(key: string, data: { enabled: boolean; percentage: number; allowlist: string[] }): Promise<FlagView> {
    const row = await this.flags.save(this.flags.create({ key, ...data }));
    await this.redis.del(`flags:${key}`); // інвалідація: наступний isOn піде в базу
    return toView(row);
  }

  async remove(key: string): Promise<void> {
    await this.flags.delete({ key });
    await this.redis.del(`flags:${key}`);
  }
}

function toView(row: FeatureFlag): FlagView {
  return { key: row.key, enabled: row.enabled, percentage: row.percentage, allowlist: row.allowlist };
}
