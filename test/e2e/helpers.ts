// Спільні помічники e2e: підняти застосунок, зареєструвати tenant з admin, створити товар.
import './env';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { setupApp } from '../../src/setup-app';

export type TestApp = { app: NestExpressApplication; http: () => request.Agent };

export async function createApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
  setupApp(app);
  await app.init();
  return { app, http: () => request(app.getHttpServer()) };
}

export type Session = { token: string; userId: string; tenantId: string; email: string; tenantSlug: string };

/** Новий tenant зі свіжим slug: перший користувач стає admin. */
export async function registerTenant(t: TestApp, prefix = 'tenant'): Promise<Session> {
  const tenantSlug = `${prefix}-${randomUUID().slice(0, 8)}`;
  return registerUser(t, tenantSlug, `admin-${randomUUID().slice(0, 8)}@example.com`);
}

export async function registerUser(t: TestApp, tenantSlug: string, email: string): Promise<Session> {
  const res = await t.http().post('/auth/register').send({ tenantSlug, email, password: 'password123' }).expect(201);
  return { token: res.body.accessToken, userId: res.body.user.id, tenantId: res.body.user.tenantId, email, tenantSlug };
}

export function auth(session: Session): { Authorization: string } {
  return { Authorization: `Bearer ${session.token}` };
}

export async function createProduct(t: TestApp, session: Session, data: { sku?: string; name?: string; priceCents?: number; stock?: number } = {}): Promise<{ id: string; version: number; stock: number; sku: string }> {
  const res = await t.http().post('/products').set(auth(session)).send({
    sku: data.sku ?? `SKU-${randomUUID().slice(0, 8)}`,
    name: data.name ?? 'Тестовий товар',
    priceCents: data.priceCents ?? 1000,
    stock: data.stock ?? 10,
  }).expect(201);
  return res.body;
}

export async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000, stepMs = 100): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  throw new Error(`waitFor: умова не виконалась за ${timeoutMs} мс`);
}
