// Ручний circuit breaker на ~60 рядків, щоб було видно, що всередині opossum немає магії.
// closed: усі виклики йдуть далі. open: падаємо одразу. half-open: пропускаємо один пробний виклик.
export type BreakerState = 'closed' | 'open' | 'half-open';

export type BreakerOptions = {
  failureThreshold: number; // скільки помилок (штук, не відсоток: на відміну від opossum, див. docs/modules/circuit-breaker.md)
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
  // "Покоління" breaker-а: +1 щоразу, коли він відкривається або закривається.
  // Виклик, що стартував в одному поколінні, не може впливати на стан наступного.
  private epoch = 0;

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
    const trial = state === 'half-open';
    if (trial) {
      if (this.trialInFlight) throw new CircuitOpenError(); // лише один пробний виклик
      this.trialInFlight = true;
    }
    const epoch = this.epoch;
    // Виклик, який стартував у closed, а завершився вже після відкриття breaker-а, "застарілий":
    // його результат нічого не каже про те, чи ожив провайдер зараз. Закрити breaker може лише пробний виклик.
    const counts = (): boolean => trial || this.epoch === epoch;
    try {
      const result = await withTimeout(fn(), this.options.callTimeoutMs);
      if (counts()) this.onSuccess();
      return result;
    } catch (error) {
      if (counts() && (!this.options.ignoreError || !this.options.ignoreError(error))) this.onFailure();
      throw error;
    } finally {
      if (trial) this.trialInFlight = false; // прапорець скидає лише той виклик, що його виставив
    }
  }

  private onSuccess(): void {
    if (this.openedAt !== 0) this.epoch += 1; // закрились
    this.failures = [];
    this.openedAt = 0;
  }

  private onFailure(): void {
    if (this.openedAt !== 0) { this.openedAt = this.now(); return; } // пробний виклик упав: знову open
    this.failures.push(this.now());
    this.pruneWindow();
    if (this.failures.length >= this.options.failureThreshold) {
      this.openedAt = this.now();
      this.epoch += 1; // відкрились
    }
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
