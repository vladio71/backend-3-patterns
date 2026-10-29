// Модуль optimistic-lock: два клієнти прочитали version 1, обидва роблять PATCH, перший виграє, другий отримує 409 STALE_VERSION.
import { auth, createApp, createProduct, registerTenant, Session, TestApp } from './helpers';

describe('optimistic-lock', () => {
  let t: TestApp;
  let admin: Session;

  beforeAll(async () => {
    t = await createApp();
    admin = await registerTenant(t, 'optlock');
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('другий PATCH зі старою version отримує 409 і поточну версію', async () => {
    const product = await createProduct(t, admin, { name: 'Старе ім\'я' });
    expect(product.version).toBe(1);

    const first = await t.http().patch(`/products/${product.id}`).set(auth(admin)).send({ version: 1, name: 'Клієнт А' }).expect(200);
    expect(first.body.version).toBe(2);
    expect(first.body.name).toBe('Клієнт А');

    const second = await t.http().patch(`/products/${product.id}`).set(auth(admin)).send({ version: 1, name: 'Клієнт Б' }).expect(409);
    expect(second.body).toMatchObject({ code: 'STALE_VERSION', currentVersion: 2 });

    const current = await t.http().get(`/products/${product.id}`).set(auth(admin)).expect(200);
    expect(current.body.name).toBe('Клієнт А');

    const retry = await t.http().patch(`/products/${product.id}`).set(auth(admin)).send({ version: 2, name: 'Клієнт Б' }).expect(200);
    expect(retry.body.version).toBe(3);
  });

  it('PATCH без version відхиляється валідацією', async () => {
    const product = await createProduct(t, admin);
    await t.http().patch(`/products/${product.id}`).set(auth(admin)).send({ name: 'x' }).expect(400);
  });

  it('паралельні PATCH з однією version: рівно один проходить', async () => {
    const product = await createProduct(t, admin);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => t.http().patch(`/products/${product.id}`).set(auth(admin)).send({ version: 1, name: `Клієнт ${i}` })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
  });
});
