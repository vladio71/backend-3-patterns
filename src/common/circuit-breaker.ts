// Ручний circuit breaker на ~60 рядків, щоб було видно, що всередині opossum немає магії.
// closed: усі виклики йдуть далі. open: падаємо одразу. half-open: пропускаємо один пробний виклик.
export type BreakerState = 'closed' | 'open' | 'half-open';

export type BreakerOptions = {
  failureThreshold: number; // скільки помилок
  windowMs: number;         // за який проміжок часу
  resetMs: number;          // через скільки після відкриття спробувати знову
  callTimeoutMs: number;    // довший виклик рахуємо як помилку
  ignoreError?: (error: unknown) => boolean; // бізнес-помилки (напр. "відхилено") не рахуємо
};

export class CircuitOpenError extends Error {
  constructor() {
    super('Circuit breaker is open');
  }
}

export class CircuitBreaker {
  private failures: number[] = []; // мітки часу помилок у вікні
  private openedAt = 0;
  private trialInFlight = false;

  constructor(private readonly options: BreakerOptions, private readonly now: () => number = Date.now) {}

  state(): BreakerState {
    if (this.openedAt === 0) return 'closed';
    return this.now() - this.openedAt >= this.options.resetMs ? 'half-open' : 'open';
  }

  failureCount(): number {
    this.pruneWindow();
    return this.failures.length;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state();
    if (state === 'open') throw new CircuitOpenError();
    if (state === 'half-open') {
      if (this.trialInFlight) throw new CircuitOpenError(); // лише один пробний виклик
      this.trialInFlight = true;
    }
    try {
      const result = await withTimeout(fn(), this.options.callTimeoutMs);
      this.onSuccess();
      return result;
    } catch (error) {
      if (!this.options.ignoreError || !this.options.ignoreError(error)) this.onFailure();
      throw error;
    } finally {
      this.trialInFlight = false;
    }
  }

  private onSuccess(): void {
    this.failures = [];
    this.openedAt = 0;
  }

  private onFailure(): void {
    if (this.openedAt !== 0) { this.openedAt = this.now(); return; } // пробний виклик упав: знову open
    this.failures.push(this.now());
    this.pruneWindow();
    if (this.failures.length >= this.options.failureThreshold) this.openedAt = this.now();
  }

  private pruneWindow(): void {
    const from = this.now() - this.options.windowMs;
    this.failures = this.failures.filter((at) => at >= from);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms} ms`)), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}
