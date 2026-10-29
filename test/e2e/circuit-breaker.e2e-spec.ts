// Модуль circuit-breaker: 5 помилок відкривають breaker, далі 503 за < 5 мс, після reset один пробний виклик закриває.
// Запускається двічі: BREAKER_IMPL=opossum і BREAKER_IMPL=custom.
import { auth, createApp, createProduct, registerTenant, Session, TestApp } from './helpers';

const RESET_MS = 600;

for (const impl of ['opossum', 'custom']) {
  describe(`circuit-breaker (${impl})`, () => {
    let t: TestApp;
    let admin: Session;
    let productId: string;

    beforeAll(async () => {
      process.env.BREAKER_IMPL = impl;
      process.env.BREAKER_RESET_MS = String(RESET_MS);
      process.env.BREAKER_CALL_TIMEOUT_MS = '1000';
      t = await createApp();
      admin = await registerTenant(t, `breaker-${impl}`);
      productId = (await createProduct(t, admin, { stock: 1000, priceCents: 1000 })).id;
      await t.http().post('/demo/payment-provider').set(auth(admin)).send({ failing: false, latencyMs: 0 }).expect(201);
    });

    afterAll(async () => {
      await t.http().post('/demo/payment-provider').set(auth(admin)).send({ failing: false, latencyMs: 0 });
      await t.app.close();
    });

    function checkout(): Promise<{ status: number; body: { code?: string } }> {
      return t.http().post('/checkout').set(auth(admin)).send({ items: [{ productId, qty: 1 }], address: 'Миколаїв' });
    }

    it('стан на старті closed, успішний виклик проходить', async () => {
      const state = await t.http().get('/demo/payment-provider/state').set(auth(admin)).expect(200);
      expect(state.body.breaker).toMatchObject({ impl, state: 'closed' });
      expect((await checkout()).status).toBe(201);
    });

    it('5 помилок провайдера відкривають breaker, далі fail-fast 503 за < 5 мс', async () => {
      await t.http().post('/demo/payment-provider').set(auth(admin)).send({ failing: true, latencyMs: 300 }).expect(201);

      for (let i = 0; i < 5; i++) {
        const res = await checkout();
        expect(res.status).toBe(503); // провайдер лежить: кожен виклик чекає latency і падає
        expect(res.body.code).toBe('CHECKOUT_FAILED');
      }
      const state = await t.http().get('/demo/payment-provider/state').set(auth(admin)).expect(200);
      expect(state.body.breaker.state).toBe('open');

      // Breaker відкритий: без походу в провайдер (300 мс latency). Міряємо чистий виклик клієнта, без HTTP.
      const { PaymentClient } = await import('../../src/modules/payments/payment.client');
      const client = t.app.get(PaymentClient);
      const started = performance.now();
      await expect(client.charge('order', 100, false)).rejects.toMatchObject({ response: { code: 'PAYMENT_UNAVAILABLE' } });
      const elapsed = performance.now() - started;
      expect(elapsed).toBeLessThan(5);

      const res = await checkout();
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('CHECKOUT_FAILED');
    });

    it('після reset timeout один пробний виклик закриває breaker', async () => {
      await t.http().post('/demo/payment-provider').set(auth(admin)).send({ failing: false, latencyMs: 0 }).expect(201);
      await new Promise((r) => setTimeout(r, RESET_MS + 100));

      const state = await t.http().get('/demo/payment-provider/state').set(auth(admin)).expect(200);
      expect(['half-open', 'open']).toContain(state.body.breaker.state); // opossum показує half-open лише після спроби

      const trial = await checkout();
      expect(trial.status).toBe(201);

      const after = await t.http().get('/demo/payment-provider/state').set(auth(admin)).expect(200);
      expect(after.body.breaker.state).toBe('closed');
    });
  });
}
