import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { AppConfig } from '../../common/config';
import { RequestContext } from '../../common/request-context';
import { FeatureFlag } from './feature-flag.entity';
import { FeatureFlagsService, rolloutBucket } from './feature-flags.service';

describe('rolloutBucket', () => {
  it('детермінований: той самий userId і key дають те саме число', () => {
    expect(rolloutBucket('user-1', 'products-v2-default')).toBe(rolloutBucket('user-1', 'products-v2-default'));
  });

  it('значення в межах 0..99', () => {
    for (let i = 0; i < 500; i++) {
      const bucket = rolloutBucket(`user-${i}`, 'any');
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
  });

  it('при 30 % приблизно 30 % користувачів потрапляють у rollout', () => {
    let on = 0;
    const total = 5000;
    for (let i = 0; i < total; i++) if (rolloutBucket(`user-${i}`, 'flag') < 30) on++;
    expect(on / total).toBeGreaterThan(0.26);
    expect(on / total).toBeLessThan(0.34);
  });
});

describe('FeatureFlagsService.isOn, коли Redis недоступний', () => {
  const config = { flags: { cacheTtlSec: 10 } } as AppConfig;
  const rowOn = { tenantId: 'tenant-1', key: 'k', enabled: true, percentage: 100, allowlist: [] };
  const ctx = { tenantIdOrFail: () => 'tenant-1' } as RequestContext;

  function make(redis: Partial<Redis>): FeatureFlagsService {
    const repo = { findOne: jest.fn().mockResolvedValue(rowOn) } as unknown as Repository<FeatureFlag>;
    return new FeatureFlagsService(repo, redis as Redis, config, ctx);
  }

  it('повертає false і не кидає помилку', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = make({ get: jest.fn().mockRejectedValue(new Error('Reached the max retries per request limit (which is 1)')) });
    await expect(service.isOn('k', 'user-1')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('вважаю його вимкненим'));
    warn.mockRestore();
  });

  it('з працюючим Redis прапорець на 100 % вмикається', async () => {
    const service = make({ get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') });
    await expect(service.isOn('k', 'user-1')).resolves.toBe(true);
  });

  it('upsert не падає, якщо не вдалося скинути кеш', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const repo = { create: jest.fn((v) => v), save: jest.fn(async (v) => v) } as unknown as Repository<FeatureFlag>;
    const service = new FeatureFlagsService(repo, { del: jest.fn().mockRejectedValue(new Error('down')) } as unknown as Redis, config, ctx);
    await expect(service.upsert('k', { enabled: true, percentage: 10, allowlist: [] })).resolves.toMatchObject({ key: 'k', percentage: 10 });
    warn.mockRestore();
  });

  it('ключ кешу містить tenant: однакове ім\'я прапорця в різних tenants не змішується', async () => {
    const get = jest.fn().mockResolvedValue(null);
    await make({ get, set: jest.fn().mockResolvedValue('OK') }).isOn('k', 'user-1');
    expect(get).toHaveBeenCalledWith('flags:tenant-1:k');
  });
});
