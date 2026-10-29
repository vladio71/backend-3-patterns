import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

describe('CircuitBreaker (ручний)', () => {
  let now = 1_000;
  const clock = () => now;
  const failing = async (): Promise<string> => { throw new Error('provider down'); };
  const ok = async (): Promise<string> => 'ok';

  function make(): CircuitBreaker {
    now = 1_000;
    return new CircuitBreaker({ failureThreshold: 5, windowMs: 10_000, resetMs: 30_000, callTimeoutMs: 100 }, clock);
  }

  it('відкривається після 5 помилок у вікні', async () => {
    const breaker = make();
    for (let i = 0; i < 5; i++) await expect(breaker.exec(failing)).rejects.toThrow('provider down');
    expect(breaker.state()).toBe('open');
    await expect(breaker.exec(ok)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('помилки поза вікном 10 с не рахуються', async () => {
    const breaker = make();
    for (let i = 0; i < 4; i++) await expect(breaker.exec(failing)).rejects.toThrow();
    now += 11_000;
    await expect(breaker.exec(failing)).rejects.toThrow('provider down');
    expect(breaker.state()).toBe('closed');
    expect(breaker.failureCount()).toBe(1);
  });

  it('після resetMs стає half-open, успішний пробний виклик закриває', async () => {
    const breaker = make();
    for (let i = 0; i < 5; i++) await expect(breaker.exec(failing)).rejects.toThrow();
    now += 30_000;
    expect(breaker.state()).toBe('half-open');
    await expect(breaker.exec(ok)).resolves.toBe('ok');
    expect(breaker.state()).toBe('closed');
  });

  it('невдалий пробний виклик знову відкриває', async () => {
    const breaker = make();
    for (let i = 0; i < 5; i++) await expect(breaker.exec(failing)).rejects.toThrow();
    now += 30_000;
    await expect(breaker.exec(failing)).rejects.toThrow('provider down');
    expect(breaker.state()).toBe('open');
  });

  it('довгий виклик рахується як помилка (timeout)', async () => {
    const breaker = make();
    const slow = () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 300));
    await expect(breaker.exec(slow)).rejects.toThrow('Timeout');
    expect(breaker.failureCount()).toBe(1);
  });
});
