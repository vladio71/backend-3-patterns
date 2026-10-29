// Початкова схема. Написана руками, щоб було видно кожен індекс і кожне обмеження.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1730000000000 implements MigrationInterface {
  name = 'Init1730000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await q.query(`CREATE TABLE tenants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL UNIQUE,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);

    await q.query(`CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      email text NOT NULL,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'user',
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE UNIQUE INDEX users_tenant_email_uq ON users (tenant_id, email)`);

    await q.query(`CREATE TABLE products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      sku text NOT NULL,
      name text NOT NULL,
      price_cents integer NOT NULL CHECK (price_cents >= 0),
      currency text NOT NULL DEFAULT 'UAH',
      stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz NULL
    )`);
    // Soft delete ламає звичайний UNIQUE(tenant_id, sku): видалений товар блокував би свій sku назавжди.
    // Частковий індекс рахує лише живі рядки.
    await q.query(`CREATE UNIQUE INDEX products_tenant_sku_live_uq ON products (tenant_id, sku) WHERE deleted_at IS NULL`);
    await q.query(`CREATE INDEX products_tenant_created_idx ON products (tenant_id, created_at)`);

    await q.query(`CREATE TABLE product_images (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      product_id uuid NOT NULL REFERENCES products(id),
      key text NOT NULL UNIQUE,
      content_type text NOT NULL,
      size integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE INDEX product_images_tenant_product_idx ON product_images (tenant_id, product_id)`);

    await q.query(`CREATE TABLE orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      user_id uuid NOT NULL REFERENCES users(id),
      status text NOT NULL DEFAULT 'pending',
      total_cents integer NOT NULL,
      currency text NOT NULL DEFAULT 'UAH',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE INDEX orders_tenant_status_idx ON orders (tenant_id, status)`);
    await q.query(`CREATE INDEX orders_tenant_user_idx ON orders (tenant_id, user_id)`);

    await q.query(`CREATE TABLE order_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES products(id),
      qty integer NOT NULL CHECK (qty > 0),
      price_cents integer NOT NULL
    )`);
    await q.query(`CREATE INDEX order_items_order_idx ON order_items (order_id)`);
    // Індексу по product_id навмисно немає: його додає міграція AddOrderItemsProductIdx (модуль profiling).

    await q.query(`CREATE TABLE idempotency_keys (
      tenant_id uuid NOT NULL,
      key text NOT NULL,
      request_hash text NOT NULL,
      status_code integer NULL,
      response_body jsonb NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, key)
    )`);

    await q.query(`CREATE TABLE payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      order_id uuid NOT NULL REFERENCES orders(id),
      provider_ref text NOT NULL UNIQUE,
      amount_cents integer NOT NULL,
      status text NOT NULL DEFAULT 'charged',
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE INDEX payments_tenant_order_idx ON payments (tenant_id, order_id)`);

    await q.query(`CREATE TABLE processed_webhook_events (
      event_id text PRIMARY KEY,
      received_at timestamptz NOT NULL DEFAULT now()
    )`);

    await q.query(`CREATE TABLE shipments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      order_id uuid NOT NULL REFERENCES orders(id),
      address text NOT NULL,
      status text NOT NULL DEFAULT 'created',
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE INDEX shipments_tenant_order_idx ON shipments (tenant_id, order_id)`);

    await q.query(`CREATE TABLE checkout_sagas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
      step text NOT NULL DEFAULT 'reserve_stock',
      status text NOT NULL DEFAULT 'running',
      compensations_done jsonb NOT NULL DEFAULT '[]',
      payload jsonb NOT NULL,
      error text NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE INDEX checkout_sagas_status_updated_idx ON checkout_sagas (status, updated_at)`);

    await q.query(`CREATE TABLE outbox_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type text NOT NULL,
      tenant_id uuid NOT NULL,
      payload jsonb NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      published_at timestamptz NULL
    )`);
    await q.query(`CREATE INDEX outbox_events_unpublished_idx ON outbox_events (published_at, created_at)`);

    await q.query(`CREATE TABLE consumed_events (
      event_id uuid PRIMARY KEY,
      type text NOT NULL,
      effect text NOT NULL,
      handled_at timestamptz NOT NULL DEFAULT now()
    )`);

    await q.query(`CREATE TABLE audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity text NOT NULL,
      entity_id uuid NOT NULL,
      action text NOT NULL,
      "before" jsonb NULL,
      "after" jsonb NULL,
      user_id uuid NULL,
      request_id text NULL,
      at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id, at)`);

    await q.query(`CREATE TABLE feature_flags (
      key text PRIMARY KEY,
      enabled boolean NOT NULL DEFAULT false,
      percentage integer NOT NULL DEFAULT 0 CHECK (percentage BETWEEN 0 AND 100),
      allowlist text[] NOT NULL DEFAULT '{}',
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);

    await q.query(`CREATE TABLE sent_emails (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "to" text NOT NULL,
      subject text NOT NULL,
      body text NOT NULL,
      job_id text NULL,
      sent_at timestamptz NOT NULL DEFAULT now()
    )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'sent_emails', 'feature_flags', 'audit_log', 'consumed_events', 'outbox_events', 'checkout_sagas', 'shipments',
      'processed_webhook_events', 'payments', 'idempotency_keys', 'order_items', 'orders', 'product_images', 'products', 'users', 'tenants',
    ]) {
      await q.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }
}
