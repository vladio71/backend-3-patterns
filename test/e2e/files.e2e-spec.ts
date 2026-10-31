// Модуль files: presign -> "браузер" кладе байти у FakeObjectStorage -> confirm з HEAD-перевіркою -> список з presigned GET.
import { FakeObjectStorage } from '../../src/modules/files/fake-object-storage';
import { OBJECT_STORAGE } from '../../src/modules/files/object-storage';
import { auth, createApp, createProduct, registerTenant, Session, TestApp } from './helpers';

describe('files', () => {
  let t: TestApp;
  let admin: Session;
  let storage: FakeObjectStorage;
  let productId: string;

  beforeAll(async () => {
    t = await createApp();
    admin = await registerTenant(t, 'files');
    storage = t.app.get<FakeObjectStorage>(OBJECT_STORAGE);
    productId = (await createProduct(t, admin)).id;
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('presign віддає PUT URL з Content-Type і Content-Length, ключ належить товару', async () => {
    const res = await t.http().post(`/products/${productId}/images/presign`).set(auth(admin)).send({ contentType: 'image/png', size: 1234 }).expect(201);
    expect(res.body.key).toMatch(new RegExp(`^tenants/${admin.tenantId}/products/${productId}/.+\\.png$`));
    expect(res.body.upload.method).toBe('PUT');
    expect(res.body.upload.headers).toEqual({ 'Content-Type': 'image/png', 'Content-Length': '1234' });
    expect(res.body.maxBytes).toBe(2 * 1024 * 1024);
    expect(res.body.upload.expiresInSec).toBe(120); // S3_PRESIGN_EXPIRES_SEC з test/e2e/env.ts
    expect(storage.presigned).toContain(res.body.key);
  });

  it('presign відмовляє файлу більшому за 2 МБ', async () => {
    const res = await t.http().post(`/products/${productId}/images/presign`).set(auth(admin)).send({ contentType: 'image/jpeg', size: 2 * 1024 * 1024 + 1 }).expect(413);
    expect(res.body.code).toBe('IMAGE_TOO_LARGE');
  });

  it('confirm без завантаження це 400, після завантаження зображення з presigned GET у списку', async () => {
    const presign = await t.http().post(`/products/${productId}/images/presign`).set(auth(admin)).send({ contentType: 'image/jpeg', size: 500 }).expect(201);
    const key = presign.body.key;

    const early = await t.http().post(`/products/${productId}/images/confirm`).set(auth(admin)).send({ key }).expect(400);
    expect(early.body.code).toBe('OBJECT_NOT_UPLOADED');

    storage.upload(key, 500, 'image/jpeg'); // те, що робить браузер PUT-ом за presigned URL
    const confirmed = await t.http().post(`/products/${productId}/images/confirm`).set(auth(admin)).send({ key }).expect(201);
    expect(confirmed.body).toMatchObject({ key, size: 500, contentType: 'image/jpeg' });
    expect(confirmed.body.url).toContain('sig=get');

    const again = await t.http().post(`/products/${productId}/images/confirm`).set(auth(admin)).send({ key }).expect(400);
    expect(again.body.code).toBe('ALREADY_CONFIRMED');

    const list = await t.http().get(`/products/${productId}/images`).set(auth(admin)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].url).toBe(`fake://bucket/${key}?sig=get`);
  });

  it('confirm чужого ключа або ключа іншого товару це 400', async () => {
    const other = await createProduct(t, admin);
    const presign = await t.http().post(`/products/${other.id}/images/presign`).set(auth(admin)).send({ contentType: 'image/webp', size: 10 }).expect(201);
    storage.upload(presign.body.key, 10, 'image/webp');
    const res = await t.http().post(`/products/${productId}/images/confirm`).set(auth(admin)).send({ key: presign.body.key }).expect(400);
    expect(res.body.code).toBe('KEY_MISMATCH');
  });

  it('файл, завантажений більшим за ліміт в обхід presign, видаляється на confirm', async () => {
    const presign = await t.http().post(`/products/${productId}/images/presign`).set(auth(admin)).send({ contentType: 'image/png', size: 100 }).expect(201);
    storage.upload(presign.body.key, 3 * 1024 * 1024, 'image/png');
    const res = await t.http().post(`/products/${productId}/images/confirm`).set(auth(admin)).send({ key: presign.body.key }).expect(413);
    expect(res.body.code).toBe('IMAGE_TOO_LARGE');
    expect(await storage.head(presign.body.key)).toBeNull();
  });

  it('DELETE: рядок у базі видаляється, навіть якщо сховище недоступне (об\'єкт-сирота лишається для прибирання)', async () => {
    const presign = await t.http().post(`/products/${productId}/images/presign`).set(auth(admin)).send({ contentType: 'image/png', size: 100 }).expect(201);
    const key = presign.body.key;
    storage.upload(key, 100, 'image/png');
    const image = await t.http().post(`/products/${productId}/images/confirm`).set(auth(admin)).send({ key }).expect(201);

    const failure = jest.spyOn(storage, 'remove').mockRejectedValueOnce(new Error('S3 недоступний'));
    await t.http().delete(`/products/${productId}/images/${image.body.id}`).set(auth(admin)).expect(200);
    expect(failure).toHaveBeenCalledWith(key);
    failure.mockRestore();

    const list = await t.http().get(`/products/${productId}/images`).set(auth(admin)).expect(200);
    expect(list.body.map((i: { id: string }) => i.id)).not.toContain(image.body.id); // клієнт зображення вже не бачить
    expect(storage.objects.has(key)).toBe(true); // а об'єкт у сховищі лишився
  });

  it('DELETE у нормі видаляє і рядок, і об\'єкт', async () => {
    const presign = await t.http().post(`/products/${productId}/images/presign`).set(auth(admin)).send({ contentType: 'image/png', size: 100 }).expect(201);
    const key = presign.body.key;
    storage.upload(key, 100, 'image/png');
    const image = await t.http().post(`/products/${productId}/images/confirm`).set(auth(admin)).send({ key }).expect(201);
    await t.http().delete(`/products/${productId}/images/${image.body.id}`).set(auth(admin)).expect(200);
    expect(storage.objects.has(key)).toBe(false);
  });
});
