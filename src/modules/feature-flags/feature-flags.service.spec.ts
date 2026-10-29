import { rolloutBucket } from './feature-flags.service';

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
