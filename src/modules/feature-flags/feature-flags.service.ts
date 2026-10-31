// Feature flags: таблиця в Postgres, кеш у Redis (FLAGS_CACHE_TTL_SEC, типово 10 с), детермінований відсотковий rollout.
// Той самий користувач завжди отримує ту саму відповідь для того самого прапорця.
// Redis лежить -> isOn повертає false і пише попередження в лог (див. isOn).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { AppConfig, CONFIG } from '../../common/config';
import { FLAGS_REDIS } from '../../common/redis.provider';
import { FeatureFlag } from './feature-flag.entity';

export type FlagView = { key: string; enabled: boolean; percentage: number; allowlist: string[] };

/** hash(userId + key) % 100: стабільне число 0..99 для пари користувач+прапорець. */
export function rolloutBucket(userId: string, key: string): number {
  const digest = createHash('sha256').update(`${userId}:${key}`).digest();
  return digest.readUInt32BE(0) % 100;
}

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);

  constructor(
    @InjectRepository(FeatureFlag) private readonly flags: Repository<FeatureFlag>,
    @Inject(FLAGS_REDIS) private readonly redis: Redis,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Прапорець "вимкнено" для будь-якої помилки читання (Redis лежить, таймаут): це fail closed. Нова функція не вмикається
   * сама, а старий шлях коду працює, і запит не падає з 500 через кеш. Помилка потрапляє в лог, щоб її було видно.
   * Ціна: поки Redis лежить, усі прапорці off, навіть увімкнені на 100 %.
   */
  async isOn(key: string, userId: string | null): Promise<boolean> {
    let flag: FlagView | null;
    try {
      flag = await this.get(key);
    } catch (error) {
      this.logger.warn(`Не вдалося прочитати прапорець "${key}", вважаю його вимкненим: ${(error as Error).message}`);
      return false;
    }
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
    await this.invalidate(key); // наступний isOn піде в базу
    return toView(row);
  }

  async remove(key: string): Promise<void> {
    await this.flags.delete({ key });
    await this.invalidate(key);
  }

  /** Зміна вже в базі, тому недоступний Redis не робить запит помилкою: старий кеш сам згасне за FLAGS_CACHE_TTL_SEC. */
  private async invalidate(key: string): Promise<void> {
    try {
      await this.redis.del(`flags:${key}`);
    } catch (error) {
      this.logger.warn(`Не вдалося скинути кеш прапорця "${key}", він застаріє сам через ${this.config.flags.cacheTtlSec} с: ${(error as Error).message}`);
    }
  }
}

function toView(row: FeatureFlag): FlagView {
  return { key: row.key, enabled: row.enabled, percentage: row.percentage, allowlist: row.allowlist };
}
