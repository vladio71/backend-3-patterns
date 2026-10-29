// Модуль audit: soft delete ховає товар, restore повертає; audit_log має insert/update/soft_delete/restore з userId і requestId;
// частковий унікальний індекс дозволяє повторити sku видаленого товару.
import { auth, createApp, createProduct, registerTenant, Session, TestApp } from './helpers';

describe('audit + soft delete', () => {
  let t: TestApp;
  let admin: Session;

  beforeAll(async () => {
    t = await createApp();
    admin = await registerTenant(t, 'audit');
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('soft delete: 404 у списку і по id, є в /products/deleted, restore повертає', async () => {
    const product = await createProduct(t, admin, { sku: 'AUD-1' });
    await t.http().delete(`/products/${product.id}`).set(auth(admin)).expect(200);
    await t.http().get(`/products/${product.id}`).set(auth(admin)).expect(404);
    const list = await t.http().get('/v1/products').set(auth(admin)).expect(200);
    expect(list.body.find((p: { id: string }) => p.id === product.id)).toBeUndefined();
    const deleted = await t.http().get('/products/deleted').set(auth(admin)).expect(200);
    expect(deleted.body.map((p: { id: string }) => p.id)).toContain(product.id);

    await t.http().post(`/products/${product.id}/restore`).set(auth(admin)).expect(201);
    await t.http().get(`/products/${product.id}`).set(auth(admin)).expect(200);
  });

  it('частковий унікальний індекс: sku видаленого товару можна використати знову', async () => {
    const product = await createProduct(t, admin, { sku: 'AUD-REUSE' });
    await t.http().post('/products').set(auth(admin)).send({ sku: 'AUD-REUSE', name: 'дубль', priceCents: 1, stock: 1 }).expect(409);
    await t.http().delete(`/products/${product.id}`).set(auth(admin)).expect(200);
    await t.http().post('/products').set(auth(admin)).send({ sku: 'AUD-REUSE', name: 'новий', priceCents: 1, stock: 1 }).expect(201);
    // Відновити старий тепер не можна: живий sku зайнятий
    const restore = await t.http().post(`/products/${product.id}/restore`).set(auth(admin)).expect(409);
    expect(restore.body.code).toBe('SKU_TAKEN');
  });

  it('audit_log: insert, update, soft_delete, restore з userId і requestId', async () => {
    const product = await createProduct(t, admin, { sku: 'AUD-LOG', name: 'до' });
    await t.http().patch(`/products/${product.id}`).set(auth(admin)).set('X-Request-Id', 'req-patch-1').send({ version: 1, name: 'після' }).expect(200);
    await t.http().delete(`/products/${product.id}`).set(auth(admin)).expect(200);
    await t.http().post(`/products/${product.id}/restore`).set(auth(admin)).expect(201);

    const log = await t.http().get('/audit').set(auth(admin)).query({ entity: 'product', entityId: product.id }).expect(200);
    const actions = log.body.map((row: { action: string }) => row.action);
    expect(actions).toEqual(['insert', 'update', 'soft_delete', 'restore']);

    const update = log.body[1];
    expect(update.before.name).toBe('до');
    expect(update.after.name).toBe('після');
    expect(update.userId).toBe(admin.userId);
    expect(update.requestId).toBe('req-patch-1');
    expect(log.body[2].after.deletedAt).not.toBeNull();
  });

  it('audit для замовлень: insert при створенні', async () => {
    const product = await createProduct(t, admin);
    const order = await t.http().post('/orders').set(auth(admin)).send({ items: [{ productId: product.id, qty: 1 }] }).expect(201);
    const log = await t.http().get('/audit').set(auth(admin)).query({ entity: 'order', entityId: order.body.id }).expect(200);
    expect(log.body.map((row: { action: string }) => row.action)).toEqual(['insert']);
  });

  it('звичайний користувач не бачить /audit', async () => {
    const { registerUser } = await import('./helpers');
    const user = await registerUser(t, admin.tenantSlug, 'user-audit@example.com');
    await t.http().get('/audit').set(auth(user)).query({ entity: 'product', entityId: admin.userId }).expect(403);
  });
});
