// Модуль saga: відмова платежу повертає stock, саґа compensated, замовлення cancelled; падіння процесу підхоплює SagaResumer.
// Ефект кроку і перехід на наступний крок атомарні; повторний charge не списує вдруге; два resumer-и не виконують одну саґу двічі.
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { AppConfig, CONFIG } from '../../src/common/config';
import { RequestContext } from '../../src/common/request-context';
import { REDIS } from '../../src/common/redis.provider';
import { CheckoutSaga } from '../../src/modules/checkout/checkout-saga.entity';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { SagaResumer } from '../../src/modules/checkout/saga-resumer';
import { Shipment } from '../../src/modules/checkout/shipment.entity';
import { Order } from '../../src/modules/orders/order.entity';
import { OutboxEvent } from '../../src/modules/outbox/outbox-event.entity';
import { FakePaymentProvider, PAYMENT_CHARGES_KEY } from '../../src/modules/payments/fake-payment.provider';
import { Payment } from '../../src/modules/payments/payment.entity';
import { signWebhook } from '../../src/modules/payments/webhook-signature';
import { auth, createApp, createProduct, registerTenant, Session, TestApp } from './helpers';

describe('saga', () => {
  let t: TestApp;
  let admin: Session;
  let ds: DataSource;

  beforeAll(async () => {
    t = await createApp();
    admin = await registerTenant(t, 'saga');
    ds = t.app.get(DataSource);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('успішний checkout: stock списано, замовлення shipped, саґа completed', async () => {
    const product = await createProduct(t, admin, { stock: 5, priceCents: 1000 });
    const res = await t.http().post('/checkout').set(auth(admin)).send({ items: [{ productId: product.id, qty: 2 }], address: 'Миколаїв' }).expect(201);
    expect(res.body).toMatchObject({ status: 'completed', step: 'done' });
    expect(res.body.shipmentId).toBeTruthy();

    const after = await t.http().get(`/products/${product.id}`).set(auth(admin)).expect(200);
    expect(after.body.stock).toBe(3);
    const order = await t.http().get(`/orders/${res.body.orderId}`).set(auth(admin)).expect(200);
    expect(order.body.status).toBe('shipped');
  });

  it('платіж відхилено (X-Fail-Payment): stock повернуто, саґа compensated, замовлення cancelled', async () => {
    const product = await createProduct(t, admin, { stock: 5, priceCents: 1000 });
    const res = await t.http().post('/checkout').set(auth(admin)).set('X-Fail-Payment', '1')
      .send({ items: [{ productId: product.id, qty: 2 }], address: 'Миколаїв' }).expect(402);
    expect(res.body.code).toBe('CHECKOUT_FAILED');
    expect(res.body.step).toBe('charge_payment');

    const after = await t.http().get(`/products/${product.id}`).set(auth(admin)).expect(200);
    expect(after.body.stock).toBe(5);

    const saga = await ds.getRepository(CheckoutSaga).findOneByOrFail({ id: res.body.sagaId });
    expect(saga.status).toBe('compensated');
    expect(saga.compensationsDone).toEqual(['release_stock']);

    const order = await t.http().get(`/orders/${res.body.orderId}`).set(auth(admin)).expect(200);
    expect(order.body.status).toBe('cancelled');
    expect(await ds.getRepository(Shipment).count({ where: { orderId: res.body.orderId } })).toBe(0);
  });

  it('сума на .99 теж відхиляється провайдером', async () => {
    const product = await createProduct(t, admin, { stock: 5, priceCents: 1099 });
    const res = await t.http().post('/checkout').set(auth(admin)).send({ items: [{ productId: product.id, qty: 1 }], address: 'Одеса' }).expect(402);
    expect(res.body.step).toBe('charge_payment');
  });

  it('недостатньо товару: саґа падає на reserve_stock, нічого списувати не треба', async () => {
    const product = await createProduct(t, admin, { stock: 1 });
    const res = await t.http().post('/checkout').set(auth(admin)).send({ items: [{ productId: product.id, qty: 2 }], address: 'Київ' }).expect(409);
    expect(res.body.step).toBe('reserve_stock');
    const saga = await ds.getRepository(CheckoutSaga).findOneByOrFail({ id: res.body.sagaId });
    expect(saga.status).toBe('compensated');
    expect(saga.compensationsDone).toEqual([]);
    expect(await ds.getRepository(Payment).count({ where: { orderId: res.body.orderId } })).toBe(0);
  });

  it('падіння процесу після reserve_stock: саґа running, worker доводить її до кінця', async () => {
    const product = await createProduct(t, admin, { stock: 5, priceCents: 1000 });
    const res = await t.http().post('/checkout').set(auth(admin)).set('X-Crash-After', 'reserve_stock')
      .send({ items: [{ productId: product.id, qty: 1 }], address: 'Львів' }).expect(500);
    expect(res.body.code).toBe('SIMULATED_CRASH');

    let saga = await ds.getRepository(CheckoutSaga).findOneByOrFail({ id: res.body.sagaId });
    expect(saga.status).toBe('running');
    expect(saga.step).toBe('charge_payment');

    const resumed = await t.app.get(SagaResumer).tick(); // SAGA_RESUME_AFTER_MS=0 у тестах
    expect(resumed).toBeGreaterThanOrEqual(1);
    saga = await ds.getRepository(CheckoutSaga).findOneByOrFail({ id: res.body.sagaId });
    expect(saga.status).toBe('completed');
    expect(saga.payload.shipmentId).toBeTruthy();
    const after = await t.http().get(`/products/${product.id}`).set(auth(admin)).expect(200);
    expect(after.body.stock).toBe(4);
  });

  describe('атомарність кроку і переходу', () => {
    // Збій імітуємо тригерами в тестовій базі: вони спрацьовують лише для спеціальних адрес доставки.
    // Так ми ламаємо саме запис переходу saga.step, не змінюючи код сервісу.
    beforeAll(async () => {
      await ds.query(`CREATE OR REPLACE FUNCTION test_fail_saga() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test: збій запису саґи'; END; $$`);
      await ds.query(`CREATE TRIGGER test_fail_saga_insert BEFORE INSERT ON checkout_sagas FOR EACH ROW WHEN (NEW.payload->>'address' = 'FAIL-SAGA-INSERT') EXECUTE FUNCTION test_fail_saga()`);
      await ds.query(`CREATE TRIGGER test_fail_to_charge BEFORE UPDATE ON checkout_sagas FOR EACH ROW WHEN (NEW.step = 'charge_payment' AND NEW.payload->>'address' = 'FAIL-TO-CHARGE') EXECUTE FUNCTION test_fail_saga()`);
      await ds.query(`CREATE TRIGGER test_fail_to_shipment BEFORE UPDATE ON checkout_sagas FOR EACH ROW WHEN (NEW.step = 'create_shipment' AND NEW.payload->>'address' = 'FAIL-TO-SHIPMENT') EXECUTE FUNCTION test_fail_saga()`);
      await ds.query(`CREATE TRIGGER test_fail_to_done BEFORE UPDATE ON checkout_sagas FOR EACH ROW WHEN (NEW.step = 'done' AND NEW.payload->>'address' = 'FAIL-TO-DONE') EXECUTE FUNCTION test_fail_saga()`);
    });

    afterAll(async () => {
      for (const name of ['test_fail_saga_insert', 'test_fail_to_charge', 'test_fail_to_shipment', 'test_fail_to_done']) {
        await ds.query(`DROP TRIGGER IF EXISTS ${name} ON checkout_sagas`);
      }
      await ds.query('DROP FUNCTION IF EXISTS test_fail_saga()');
    });

    it('запис саґи впав: замовлення і подія order.created теж не створені (одна транзакція)', async () => {
      const tenant = await registerTenant(t, 'saga-order-tx');
      const product = await createProduct(t, tenant, { stock: 5 });
      const res = await t.http().post('/checkout').set(auth(tenant)).send({ items: [{ productId: product.id, qty: 1 }], address: 'FAIL-SAGA-INSERT' });
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(await ds.getRepository(Order).count({ where: { tenantId: tenant.tenantId } })).toBe(0);
      expect(await ds.getRepository(OutboxEvent).count({ where: { tenantId: tenant.tenantId } })).toBe(0);
    });

    it('перехід після reserve_stock не записався: списання складу відкотилось разом із ним', async () => {
      const product = await createProduct(t, admin, { stock: 5, priceCents: 1000 });
      const res = await t.http().post('/checkout').set(auth(admin)).send({ items: [{ productId: product.id, qty: 2 }], address: 'FAIL-TO-CHARGE' });
      expect(res.body.code).toBe('CHECKOUT_FAILED');
      expect(res.body.step).toBe('reserve_stock');

      const after = await t.http().get(`/products/${product.id}`).set(auth(admin)).expect(200);
      expect(after.body.stock).toBe(5); // без однієї транзакції тут було б 3: склад списано, а крок не перейшов
      const saga = await ds.getRepository(CheckoutSaga).findOneByOrFail({ id: res.body.sagaId });
      expect(saga).toMatchObject({ status: 'compensated', step: 'reserve_stock' });
      expect(saga.compensationsDone).toEqual([]);
    });

    it('перехід після charge_payment не записався: рядка платежу і статусу paid немає, гроші повертаються', async () => {
      const product = await createProduct(t, admin, { stock: 5, priceCents: 1000 });
      const res = await t.http().post('/checkout').set(auth(admin)).send({ items: [{ productId: product.id, qty: 1 }], address: 'FAIL-TO-SHIPMENT' });
      expect(res.body.code).toBe('CHECKOUT_FAILED');
      expect(res.body.step).toBe('charge_payment');

      expect(await ds.getRepository(Payment).count({ where: { orderId: res.body.orderId } })).toBe(0); // відкотився разом зі збоєм переходу
      const saga = await ds.getRepository(CheckoutSaga).findOneByOrFail({ id: res.body.sagaId });
      expect(saga.status).toBe('compensated');
      expect(saga.compensationsDone).toEqual(['refund', 'release_stock']); // списання відбулось у провайдера, тому refund є
      const after = await t.http().get(`/products/${product.id}`).set(auth(admin)).expect(200);
      expect(after.body.stock).toBe(5);
      expect((await t.http().get(`/orders/${res.body.orderId}`).set(auth(admin)).expect(200)).body.status).toBe('cancelled');
    });

    it('перехід після create_shipment не записався: відправлення немає', async () => {
      const product = await createProduct(t, admin, { stock: 5, priceCents: 1000 });
      const res = await t.http().post('/checkout').set(auth(admin)).send({ items: [{ productId: product.id, qty: 1 }], address: 'FAIL-TO-DONE' });
      expect(res.body.code).toBe('CHECKOUT_FAILED');
      expect(res.body.step).toBe('create_shipment');

      expect(await ds.getRepository(Shipment).count({ where: { orderId: res.body.orderId } })).toBe(0);
      const saga = await ds.getRepository(CheckoutSaga).findOneByOrFail({ id: res.body.sagaId });
      expect(saga.status).toBe('compensated');
      expect(saga.compensationsDone).toEqual(['refund', 'release_stock']);
      expect((await t.http().get(`/orders/${res.body.orderId}`).set(auth(admin)).expect(200)).body.status).toBe('cancelled');
    });
  });

  describe('charge_payment ідемпотентний', () => {
    async function crashedSaga(address: string): Promise<{ sagaId: string; orderId: string }> {
      const product = await createProduct(t, admin, { stock: 5, priceCents: 1000 });
      const res = await t.http().post('/checkout').set(auth(admin)).set('X-Crash-After', 'reserve_stock')
        .send({ items: [{ productId: product.id, qty: 1 }], address }).expect(500);
      const saga = await ds.getRepository(CheckoutSaga).findOneByOrFail({ id: res.body.sagaId });
      return { sagaId: saga.id, orderId: saga.orderId };
    }

    it('процес упав після списання в провайдера, але до запису в базу: resumer не списує вдруге', async () => {
      const { sagaId, orderId } = await crashedSaga('Київ');
      // Те, що встиг зробити "померлий" процес: провайдер списав гроші, а у нас нічого не записано.
      const { paymentRef } = await t.app.get(FakePaymentProvider).charge(orderId, 1000, false);
      expect(await ds.getRepository(Payment).count({ where: { orderId } })).toBe(0);

      await t.app.get(SagaResumer).tick();

      expect((await ds.getRepository(CheckoutSaga).findOneByOrFail({ id: sagaId })).status).toBe('completed');
      const payments = await ds.getRepository(Payment).find({ where: { orderId } });
      expect(payments.map((p) => p.providerRef)).toEqual([paymentRef]); // та сама оплата, не друга
    });

    it('платіж для замовлення вже записано (вебхук прийшов раніше): провайдера взагалі не викликаємо', async () => {
      const { sagaId, orderId } = await crashedSaga('Львів');
      const raw = JSON.stringify({ eventId: `evt-saga-${orderId}`, type: 'payment.succeeded', orderId, amountCents: 1000, paymentRef: `pay-webhook-${orderId}` });
      await t.http().post('/payments/webhook').set('Content-Type', 'application/json').set('X-Signature', signWebhook(raw, 'test-webhook-secret')).send(raw).expect(200);

      await t.app.get(SagaResumer).tick();

      expect((await ds.getRepository(CheckoutSaga).findOneByOrFail({ id: sagaId })).status).toBe('completed');
      const payments = await ds.getRepository(Payment).find({ where: { orderId } });
      expect(payments.map((p) => p.providerRef)).toEqual([`pay-webhook-${orderId}`]);
      expect(await t.app.get<Redis>(REDIS).hexists(PAYMENT_CHARGES_KEY, orderId)).toBe(0); // провайдер це замовлення не бачив
    });
  });

  it('два resumer-и паралельно: одну зависшу саґу виконує лише один', async () => {
    const product = await createProduct(t, admin, { stock: 5, priceCents: 1000 });
    const res = await t.http().post('/checkout').set(auth(admin)).set('X-Crash-After', 'reserve_stock')
      .send({ items: [{ productId: product.id, qty: 1 }], address: 'Харків' }).expect(500);
    const sagaId: string = res.body.sagaId;
    const { orderId } = await ds.getRepository(CheckoutSaga).findOneByOrFail({ id: sagaId });
    await ds.query(`UPDATE checkout_sagas SET updated_at = now() - interval '1 hour' WHERE id = $1`, [sagaId]); // "зависла" давно

    const checkout = t.app.get(CheckoutService);
    const run = jest.spyOn(checkout, 'run');
    const config = t.app.get<AppConfig>(CONFIG);
    const make = (): SagaResumer => new SagaResumer(ds, checkout, t.app.get(RequestContext), { ...config, saga: { ...config.saga, resumeAfterMs: 5_000 } });

    await Promise.all([make().tick(), make().tick()]);

    const runsOfThisSaga = run.mock.calls.filter(([saga]) => saga.id === sagaId).length;
    run.mockRestore();
    expect(runsOfThisSaga).toBe(1); // без claim обидва тики отримали б саґу з вибірки і виконали її
    expect(await ds.getRepository(Shipment).count({ where: { orderId } })).toBe(1);
    expect((await ds.getRepository(CheckoutSaga).findOneByOrFail({ id: sagaId })).status).toBe('completed');
  });
});
