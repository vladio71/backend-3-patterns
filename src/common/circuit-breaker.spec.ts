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

  describe('застарілі виклики (стартували у closed, завершились після відкриття)', () => {
    /** Виклик, який висить, поки тест не вирішить, чим він закінчиться. */
    function deferred(): { fn: () => Promise<string>; resolve: (v: string) => void; reject: (e: Error) => void } {
      let resolve!: (v: string) => void;
      let reject!: (e: Error) => void;
      const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
      return { fn: () => promise, resolve, reject };
    }

    async function openWhileInFlight(breaker: CircuitBreaker, slow: { fn: () => Promise<string> }): Promise<{ stale: Promise<string> }> {
      const stale = breaker.exec(slow.fn); // стартував, коли breaker closed
      for (let i = 0; i < 5; i++) await expect(breaker.exec(failing)).rejects.toThrow('provider down');
      expect(breaker.state()).toBe('open');
      return { stale };
    }

    function longTimeoutBreaker(): CircuitBreaker {
      now = 1_000;
      return new CircuitBreaker({ failureThreshold: 5, windowMs: 10_000, resetMs: 30_000, callTimeoutMs: 60_000 }, clock);
    }

    it('успіх застарілого виклику не закриває відкритий breaker', async () => {
      const breaker = longTimeoutBreaker();
      const slow = deferred();
      const { stale } = await openWhileInFlight(breaker, slow);
      slow.resolve('late ok');
      await expect(stale).resolves.toBe('late ok');
      expect(breaker.state()).toBe('open');
    });

    it('помилка застарілого виклику не продовжує період open', async () => {
      const breaker = longTimeoutBreaker();
      const slow = deferred();
      const { stale } = await openWhileInFlight(breaker, slow);
      now += 20_000; // до half-open лишилось 10 с
      slow.reject(new Error('late failure'));
      await expect(stale).rejects.toThrow('late failure');
      now += 10_000; // рівно resetMs від відкриття
      expect(breaker.state()).toBe('half-open'); // якби помилка зсунула openedAt, ще було б open
    });

    it('застарілий виклик не скидає прапорець пробного: другого пробного не буде', async () => {
      const breaker = longTimeoutBreaker();
      const slow = deferred();
      const { stale } = await openWhileInFlight(breaker, slow);
      now += 30_000;
      const trial = deferred();
      const trialCall = breaker.exec(trial.fn); // єдиний пробний виклик, висить
      slow.resolve('late ok');
      await stale;
      await expect(breaker.exec(ok)).rejects.toBeInstanceOf(CircuitOpenError); // пробний ще в роботі
      trial.resolve('trial ok');
      await trialCall;
      expect(breaker.state()).toBe('closed'); // закрив саме пробний
    });
  });
});
