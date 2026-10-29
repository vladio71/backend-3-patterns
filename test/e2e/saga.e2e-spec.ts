// Модуль saga: відмова платежу повертає stock, саґа compensated, замовлення cancelled; падіння процесу підхоплює SagaResumer.
import { DataSource } from 'typeorm';
import { CheckoutSaga } from '../../src/modules/checkout/checkout-saga.entity';
import { SagaResumer } from '../../src/modules/checkout/saga-resumer';
import { Shipment } from '../../src/modules/checkout/shipment.entity';
import { Payment } from '../../src/modules/payments/payment.entity';
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
});
