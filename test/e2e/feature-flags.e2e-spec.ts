// Модуль feature-flags-and-versioning: відсотковий rollout детермінований, allowlist, кеш у Redis; /v1, /v2 і /products за прапорцем.
import { rolloutBucket } from '../../src/modules/feature-flags/feature-flags.service';
import { auth, createApp, createProduct, registerTenant, registerUser, Session, TestApp } from './helpers';

describe('feature flags + versioning', () => {
  let t: TestApp;
  let admin: Session;
  const flagKey = `rollout-${Date.now()}`;

  beforeAll(async () => {
    t = await createApp();
    admin = await registerTenant(t, 'flags');
    await createProduct(t, admin, { priceCents: 1999 });
  });

  afterAll(async () => {
    await t.http().delete(`/admin/flags/products-v2-default`).set(auth(admin));
    await t.app.close();
  });

  it('percentage: користувач потрапляє в rollout рівно тоді, коли hash % 100 < percentage', async () => {
    const users: Session[] = [];
    for (let i = 0; i < 6; i++) users.push(await registerUser(t, admin.tenantSlug, `u${i}@example.com`));

    await t.http().put(`/admin/flags/${flagKey}`).set(auth(admin)).send({ enabled: true, percentage: 40, allowlist: [] }).expect(200);
    for (const user of users) {
      const res = await t.http().get(`/flags/${flagKey}`).set(auth(user)).expect(200);
      expect(res.body.on).toBe(rolloutBucket(user.userId, flagKey) < 40);
      const again = await t.http().get(`/flags/${flagKey}`).set(auth(user)).expect(200);
      expect(again.body.on).toBe(res.body.on); // детерміновано
    }
  });

  it('allowlist вмикає прапорець незалежно від відсотка; вимкнений прапорець завжди off', async () => {
    const user = await registerUser(t, admin.tenantSlug, 'allow@example.com');
    await t.http().put(`/admin/flags/${flagKey}`).set(auth(admin)).send({ enabled: true, percentage: 0, allowlist: [user.userId] }).expect(200);
    expect((await t.http().get(`/flags/${flagKey}`).set(auth(user)).expect(200)).body.on).toBe(true);
    expect((await t.http().get(`/flags/${flagKey}`).set(auth(admin)).expect(200)).body.on).toBe(false);

    await t.http().put(`/admin/flags/${flagKey}`).set(auth(admin)).send({ enabled: false, percentage: 100, allowlist: [user.userId] }).expect(200);
    expect((await t.http().get(`/flags/${flagKey}`).set(auth(user)).expect(200)).body.on).toBe(false);
  });

  it('невідомий прапорець off; звичайний користувач не має доступу до admin CRUD', async () => {
    const user = await registerUser(t, admin.tenantSlug, 'plain@example.com');
    expect((await t.http().get('/flags/no-such-flag').set(auth(user)).expect(200)).body.on).toBe(false);
    await t.http().put('/admin/flags/x').set(auth(user)).send({ enabled: true, percentage: 0, allowlist: [] }).expect(403);
  });

  it('прапорці окремі для кожного tenant: однаковий ключ у двох tenants не змішується', async () => {
    const other = await registerTenant(t, 'flags-other');
    const key = `per-tenant-${Date.now()}`;
    await t.http().put(`/admin/flags/${key}`).set(auth(admin)).send({ enabled: true, percentage: 100, allowlist: [] }).expect(200);

    expect((await t.http().get(`/flags/${key}`).set(auth(admin)).expect(200)).body.on).toBe(true);
    expect((await t.http().get(`/flags/${key}`).set(auth(other)).expect(200)).body.on).toBe(false); // у іншого tenant прапорця немає
    expect((await t.http().get('/admin/flags').set(auth(other)).expect(200)).body.map((f: { key: string }) => f.key)).not.toContain(key);
    await t.http().get(`/admin/flags/${key}`).set(auth(other)).expect(404);

    // Свій прапорець з тим самим ключем в іншого tenant не зачіпає перший; видалення теж не перетинається.
    await t.http().put(`/admin/flags/${key}`).set(auth(other)).send({ enabled: false, percentage: 0, allowlist: [] }).expect(200);
    expect((await t.http().get(`/flags/${key}`).set(auth(admin)).expect(200)).body.on).toBe(true);
    await t.http().delete(`/admin/flags/${key}`).set(auth(other)).expect(200);
    expect((await t.http().get(`/flags/${key}`).set(auth(admin)).expect(200)).body.on).toBe(true);
  });

  it('/v1/products і /v2/products мають різну форму price', async () => {
    const v1 = await t.http().get('/v1/products').set(auth(admin)).expect(200);
    expect(typeof v1.body[0].price).toBe('number');
    expect(v1.body[0].currency).toBe('UAH');
    const v2 = await t.http().get('/v2/products').set(auth(admin)).expect(200);
    expect(v2.body[0].price).toEqual({ amount: 1999, currency: 'UAH' });
    expect(v2.body[0].currency).toBeUndefined();
  });

  it('/products без версії: v1 за замовчуванням, v2 коли прапорець products-v2-default увімкнено для користувача', async () => {
    await t.http().delete('/admin/flags/products-v2-default').set(auth(admin)).expect(200);
    const before = await t.http().get('/products').set(auth(admin)).expect(200);
    expect(typeof before.body[0].price).toBe('number');

    await t.http().put('/admin/flags/products-v2-default').set(auth(admin)).send({ enabled: true, percentage: 0, allowlist: [admin.userId] }).expect(200);
    const after = await t.http().get('/products').set(auth(admin)).expect(200);
    expect(after.body[0].price).toEqual({ amount: 1999, currency: 'UAH' });

    const other = await registerUser(t, admin.tenantSlug, 'other@example.com');
    const otherRes = await t.http().get('/products').set(auth(other)).expect(200);
    expect(typeof otherRes.body[0].price).toBe('number');
  });
});
