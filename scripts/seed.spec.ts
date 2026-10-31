import { Repository } from 'typeorm';
import { FeatureFlag } from '../src/modules/feature-flags/feature-flag.entity';
import { ensureFlag, shouldSkipSeed } from './seed';

describe('seed', () => {
  it('у production з даними в базі seed пропускається', () => {
    expect(shouldSkipSeed('production', 2)).toBe(true);
  });

  it('у production на порожній базі seed виконується', () => {
    expect(shouldSkipSeed('production', 0)).toBe(false);
  });

  it('поза production seed виконується навіть коли дані є (він ідемпотентний)', () => {
    expect(shouldSkipSeed('development', 2)).toBe(false);
    expect(shouldSkipSeed(undefined, 2)).toBe(false);
  });

  it('ensureFlag не перезаписує наявний прапорець', async () => {
    const save = jest.fn();
    const flags = { findOne: jest.fn().mockResolvedValue({ key: 'products-v2-default', percentage: 80 }), save, create: jest.fn((v) => v) };
    const created = await ensureFlag(flags as unknown as Pick<Repository<FeatureFlag>, 'findOne' | 'save' | 'create'>, { key: 'products-v2-default', enabled: true, percentage: 30 });
    expect(created).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('ensureFlag створює відсутній прапорець', async () => {
    const save = jest.fn();
    const flags = { findOne: jest.fn().mockResolvedValue(null), save, create: jest.fn((v) => v) };
    const created = await ensureFlag(flags as unknown as Pick<Repository<FeatureFlag>, 'findOne' | 'save' | 'create'>, { key: 'new-checkout-ui', enabled: false, percentage: 0 });
    expect(created).toBe(true);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ key: 'new-checkout-ui', percentage: 0, allowlist: [] }));
  });
});
