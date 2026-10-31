// Модуль profiling: slow-report і fast-report повертають однакові дані; швидкий робить 1 запит замість сотень і помітно швидший.
import { auth, createApp, createProduct, registerTenant, registerUser, Session, TestApp } from './helpers';

describe('profiling', () => {
  let t: TestApp;
  let admin: Session;

  beforeAll(async () => {
    t = await createApp();
    admin = await registerTenant(t, 'profiling');
    for (let i = 0; i < 10; i++) await createProduct(t, admin, { priceCents: 100 * (i + 1), stock: 1000 });
    await t.http().post('/demo/generate-orders').set(auth(admin)).query({ count: 300 }).expect(201);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('обидва звіти дають однакові рядки, швидкий робить 1 запит', async () => {
    const slow = await t.http().get('/demo/slow-report').set(auth(admin)).expect(200);
    const fast = await t.http().get('/demo/fast-report').set(auth(admin)).expect(200);

    expect(fast.body.queries).toBe(1);
    expect(slow.body.queries).toBeGreaterThan(100);
    expect(fast.body.rows).toEqual(slow.body.rows);
    expect(fast.body.rows.reduce((sum: number, r: { soldQty: number }) => sum + r.soldQty, 0)).toBeGreaterThan(0);
    expect(fast.body.timingMs).toBeLessThan(slow.body.timingMs);
    console.log(`profiling: slow ${slow.body.timingMs} ms / ${slow.body.queries} запитів, fast ${fast.body.timingMs} ms / 1 запит`);
  });

  it('важкі демо-ендпоїнти (slow-report, generate-orders) доступні лише admin', async () => {
    const user = await registerUser(t, admin.tenantSlug, 'plain-profiling@example.com');
    await t.http().get('/demo/slow-report').set(auth(user)).expect(403);
    await t.http().post('/demo/generate-orders').set(auth(user)).query({ count: 5 }).expect(403);
  });
});
