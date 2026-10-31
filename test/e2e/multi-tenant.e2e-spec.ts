// Модуль multi-tenant: користувач tenant A не бачить товарів tenant B ні в списку, ні по прямому id (404, не 403).
import { auth, createApp, createProduct, registerTenant, registerUser, Session, TestApp } from './helpers';

describe('multi-tenant', () => {
  let t: TestApp;
  let adminA: Session;
  let adminB: Session;
  let productA: { id: string };
  let productB: { id: string };

  beforeAll(async () => {
    t = await createApp();
    adminA = await registerTenant(t, 'tenant-a');
    adminB = await registerTenant(t, 'tenant-b');
    productA = await createProduct(t, adminA, { sku: 'SAME-SKU', name: 'товар A' });
    productB = await createProduct(t, adminB, { sku: 'SAME-SKU', name: 'товар B' }); // той самий sku в іншому tenant дозволений
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('список містить лише свої товари', async () => {
    const listA = await t.http().get('/v1/products').set(auth(adminA)).expect(200);
    expect(listA.body.map((p: { id: string }) => p.id)).toEqual([productA.id]);
    const listB = await t.http().get('/v1/products').set(auth(adminB)).expect(200);
    expect(listB.body.map((p: { id: string }) => p.id)).toEqual([productB.id]);
  });

  it('чужий id це 404, а не 403: існування не витікає', async () => {
    await t.http().get(`/products/${productB.id}`).set(auth(adminA)).expect(404);
    await t.http().patch(`/products/${productB.id}`).set(auth(adminA)).send({ version: 1, name: 'x' }).expect(404);
    await t.http().delete(`/products/${productB.id}`).set(auth(adminA)).expect(404);
    await t.http().get(`/products/${productB.id}/images`).set(auth(adminA)).expect(404);
  });

  it('замовлення з чужим товаром не створюється', async () => {
    await t.http().post('/orders').set(auth(adminA)).send({ items: [{ productId: productB.id, qty: 1 }] }).expect(404);
  });

  it('звичайний користувач tenant A бачить товари A і не бачить B', async () => {
    const user = await registerUser(t, adminA.tenantSlug, 'user-a@example.com');
    const list = await t.http().get('/v1/products').set(auth(user)).expect(200);
    expect(list.body.map((p: { id: string }) => p.id)).toEqual([productA.id]);
    await t.http().get(`/products/${productB.id}`).set(auth(user)).expect(404);
  });

  it('GET /orders: звичайний користувач бачить лише свої замовлення, admin усі замовлення tenant', async () => {
    const alice = await registerUser(t, adminA.tenantSlug, 'alice-orders@example.com');
    const bob = await registerUser(t, adminA.tenantSlug, 'bob-orders@example.com');
    const body = { items: [{ productId: productA.id, qty: 1 }] };
    const aliceOrder = (await t.http().post('/orders').set(auth(alice)).send(body).expect(201)).body.id;
    const bobOrder = (await t.http().post('/orders').set(auth(bob)).send(body).expect(201)).body.id;

    const ids = async (session: Session): Promise<string[]> =>
      (await t.http().get('/orders').set(auth(session)).expect(200)).body.map((o: { id: string }) => o.id);
    expect(await ids(alice)).toEqual([aliceOrder]);
    expect(await ids(bob)).toEqual([bobOrder]);
    expect(await ids(adminA)).toEqual(expect.arrayContaining([aliceOrder, bobOrder]));
    expect(await ids(adminB)).toEqual([]); // чужий tenant не бачить нічого
  });

  it('без токена 401', async () => {
    await t.http().get('/v1/products').expect(401);
  });
});
