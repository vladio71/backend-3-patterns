// Модуль idempotency: вебхук 2x послідовно і 8x паралельно позначає замовлення оплаченим один раз; Idempotency-Key на POST /orders.
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Payment } from '../../src/modules/payments/payment.entity';
import { ProcessedWebhookEvent } from '../../src/modules/payments/processed-webhook-event.entity';
import { signWebhook } from '../../src/modules/payments/webhook-signature';
import { OutboxEvent } from '../../src/modules/outbox/outbox-event.entity';
import { auth, createApp, createProduct, registerTenant, Session, TestApp } from './helpers';

describe('idempotency', () => {
  let t: TestApp;
  let admin: Session;
  let productId: string;
  const secret = 'test-webhook-secret';

  beforeAll(async () => {
    t = await createApp();
    admin = await registerTenant(t, 'idem');
    productId = (await createProduct(t, admin, { priceCents: 2500 })).id;
  });

  afterAll(async () => {
    await t.app.close();
  });

  async function createOrder(): Promise<string> {
    const res = await t.http().post('/orders').set(auth(admin)).send({ items: [{ productId, qty: 2 }] }).expect(201);
    return res.body.id;
  }

  function webhook(body: object, sig?: string): request.Test {
    const raw = JSON.stringify(body);
    return t.http().post('/payments/webhook').set('Content-Type', 'application/json').set('X-Signature', sig ?? signWebhook(raw, secret)).send(raw);
  }

  it('відхиляє вебхук з невірним підписом', async () => {
    const orderId = await createOrder();
    const body = { eventId: 'evt-bad', type: 'payment.succeeded', orderId, amountCents: 5000 };
    await webhook(body, signWebhook(JSON.stringify(body), 'wrong')).expect(401);
    await webhook(body, 'nothex').expect(401);
  });

  it('та сама подія двічі послідовно: оплата один раз, друга відповідь duplicate: true', async () => {
    const orderId = await createOrder();
    const body = { eventId: `evt-${orderId}`, type: 'payment.succeeded', orderId, amountCents: 5000, paymentRef: `pay-${orderId}` };

    const first = await webhook(body).expect(200);
    expect(first.body).toMatchObject({ duplicate: false, status: 'paid' });
    const second = await webhook(body).expect(200);
    expect(second.body).toMatchObject({ duplicate: true });

    const order = await t.http().get(`/orders/${orderId}`).set(auth(admin)).expect(200);
    expect(order.body.status).toBe('paid');
    const payments = await t.app.get(DataSource).getRepository(Payment).count({ where: { orderId } });
    expect(payments).toBe(1);
  });

  it('та сама подія 8 разів паралельно: один рядок платежу, одна подія order.paid', async () => {
    const orderId = await createOrder();
    const body = { eventId: `evt-par-${orderId}`, type: 'payment.succeeded', orderId, amountCents: 5000 };

    const responses = await Promise.all(Array.from({ length: 8 }, () => webhook(body)));
    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 200)).toBe(true);
    const applied = responses.filter((r) => r.body.duplicate === false).length;
    const duplicates = responses.filter((r) => r.body.duplicate === true).length;
    expect(applied).toBe(1);
    expect(duplicates).toBe(7);

    const ds = t.app.get(DataSource);
    expect(await ds.getRepository(Payment).count({ where: { orderId } })).toBe(1);
    const paidEvents = await ds.getRepository(OutboxEvent).createQueryBuilder('e')
      .where(`e.type = 'order.paid' AND e.payload->>'orderId' = :orderId`, { orderId }).getCount();
    expect(paidEvents).toBe(1);
  });

  it('Idempotency-Key: той самий ключ і тіло віддають ту саму відповідь з Idempotent-Replayed', async () => {
    const key = `key-${Date.now()}`;
    const body = { items: [{ productId, qty: 1 }] };
    const first = await t.http().post('/orders').set(auth(admin)).set('Idempotency-Key', key).send(body).expect(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    const replay = await t.http().post('/orders').set(auth(admin)).set('Idempotency-Key', key).send(body).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(first.body.id);

    const orders = await t.http().get('/orders').set(auth(admin)).expect(200);
    expect(orders.body.filter((o: { id: string }) => o.id === first.body.id)).toHaveLength(1);
  });

  it('Idempotency-Key: той самий ключ з іншим тілом це 409', async () => {
    const key = `key-diff-${Date.now()}`;
    await t.http().post('/orders').set(auth(admin)).set('Idempotency-Key', key).send({ items: [{ productId, qty: 1 }] }).expect(201);
    const res = await t.http().post('/orders').set(auth(admin)).set('Idempotency-Key', key).send({ items: [{ productId, qty: 3 }] }).expect(409);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('Idempotency-Key: хеш рахується від очищеного тіла, зайві поля і порядок ключів не роблять повтор "іншим тілом"', async () => {
    const key = `key-canonical-${Date.now()}`;
    const first = await t.http().post('/orders').set(auth(admin)).set('Idempotency-Key', key)
      .send({ items: [{ productId, qty: 1 }] }).expect(201);

    // Те саме замовлення: інший порядок ключів і поле, якого немає в DTO (whitelist його відкидає).
    const replay = await t.http().post('/orders').set(auth(admin)).set('Idempotency-Key', key)
      .send({ extra: 'ignored', items: [{ qty: 1, note: 'ignored', productId }] }).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(first.body.id);
  });

  it('Idempotency-Key: невалідне тіло це 400 ще до запису ключа, ключ лишається вільним', async () => {
    const key = `key-invalid-${Date.now()}`;
    await t.http().post('/orders').set(auth(admin)).set('Idempotency-Key', key).send({ items: [] }).expect(400);
    await t.http().post('/orders').set(auth(admin)).set('Idempotency-Key', key).send({ items: [{ productId, qty: 1 }] }).expect(201);
  });

  it('вебхук із сумою, що не збігається із сумою замовлення, це 422: замовлення лишається pending, подію не позначено обробленою', async () => {
    const orderId = await createOrder(); // 2 x 2500 = 5000
    const body = { eventId: `evt-amount-${orderId}`, type: 'payment.succeeded', orderId, amountCents: 50 };

    const res = await webhook(body).expect(422);
    expect(res.body).toMatchObject({ code: 'AMOUNT_MISMATCH', expectedCents: 5000, receivedCents: 50 });

    const ds = t.app.get(DataSource);
    expect((await t.http().get(`/orders/${orderId}`).set(auth(admin)).expect(200)).body.status).toBe('pending');
    expect(await ds.getRepository(Payment).count({ where: { orderId } })).toBe(0);
    expect(await ds.getRepository(ProcessedWebhookEvent).count({ where: { eventId: body.eventId } })).toBe(0);

    // Після виправлення суми та сама подія проходить: вона не була "спалена" відхиленням.
    await webhook({ ...body, amountCents: 5000 }).expect(200);
  });

  it('унікальність не на processed_webhook_events (provider_ref уже зайнятий) це помилка, а не "duplicate"', async () => {
    const firstOrder = await createOrder();
    const secondOrder = await createOrder();
    const paymentRef = `pay-shared-${firstOrder}`;
    await webhook({ eventId: `evt-ref-1-${firstOrder}`, type: 'payment.succeeded', orderId: firstOrder, amountCents: 5000, paymentRef }).expect(200);

    const clash = await webhook({ eventId: `evt-ref-2-${secondOrder}`, type: 'payment.succeeded', orderId: secondOrder, amountCents: 5000, paymentRef });
    expect(clash.status).toBe(500);
    expect(clash.body.duplicate).toBeUndefined();
    const ds = t.app.get(DataSource);
    expect(await ds.getRepository(ProcessedWebhookEvent).count({ where: { eventId: `evt-ref-2-${secondOrder}` } })).toBe(0); // транзакція відкотилась
    expect((await t.http().get(`/orders/${secondOrder}`).set(auth(admin)).expect(200)).body.status).toBe('pending');
  });
});
