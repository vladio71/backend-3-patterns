// Ізоляція tenants для таблиць, які були глобальними: audit_log, sent_emails, feature_flags.
// Плюс idempotency_keys: ключ тепер унікальний у межах (tenant, користувач), а не лише tenant.
// processed_webhook_events і consumed_events лишаються глобальними свідомо (див. docs/modules/multi-tenant.md).
import { MigrationInterface, QueryRunner } from 'typeorm';

export class TenantScopeAuditEmailsFlags1730000002000 implements MigrationInterface {
  name = 'TenantScopeAuditEmailsFlags1730000002000';

  public async up(q: QueryRunner): Promise<void> {
    // audit_log: tenant береться від сутності, до якої належить запис (товар або замовлення). Нові записи отримують його від підписника.
    // NOT NULL: рядок журналу без tenant не показав би жоден admin. Усі товари й замовлення лишаються в базі (soft delete),
    // тому незабекфілених рядків не буде; якщо вони все ж є, міграція впаде тут, а не приховає їх.
    await q.query(`ALTER TABLE audit_log ADD COLUMN tenant_id uuid REFERENCES tenants(id)`);
    await q.query(`UPDATE audit_log a SET tenant_id = p.tenant_id FROM products p WHERE a.entity = 'product' AND a.entity_id = p.id`);
    await q.query(`UPDATE audit_log a SET tenant_id = o.tenant_id FROM orders o WHERE a.entity = 'order' AND a.entity_id = o.id`);
    await q.query(`ALTER TABLE audit_log ALTER COLUMN tenant_id SET NOT NULL`);
    await q.query(`DROP INDEX audit_log_entity_idx`);
    await q.query(`CREATE INDEX audit_log_tenant_entity_idx ON audit_log (tenant_id, entity, entity_id, at)`);

    // sent_emails: tenant_id NULLABLE. Лист може прийти без tenant: системний (job без tenantId) або зі старого job,
    // поставленого в чергу до цієї міграції. Існуючі рядки лишаються з NULL: за email-адресою tenant не відновити
    // (той самий email може бути в двох tenants). Рядки з NULL не показує жоден tenant.
    await q.query(`ALTER TABLE sent_emails ADD COLUMN tenant_id uuid NULL REFERENCES tenants(id)`);
    await q.query(`CREATE INDEX sent_emails_tenant_sent_idx ON sent_emails (tenant_id, sent_at)`);

    // feature_flags: ключ стає парою (tenant_id, key). Кожен наявний глобальний прапорець копіюється в усі наявні tenants
    // з тими самими значеннями, тож поведінка після міграції не змінюється. Нові tenants починають без прапорців (все off).
    await q.query(`ALTER TABLE feature_flags DROP CONSTRAINT feature_flags_pkey`);
    await q.query(`ALTER TABLE feature_flags ADD COLUMN tenant_id uuid REFERENCES tenants(id)`);
    await q.query(`INSERT INTO feature_flags (tenant_id, key, enabled, percentage, allowlist, updated_at)
      SELECT t.id, f.key, f.enabled, f.percentage, f.allowlist, f.updated_at FROM feature_flags f CROSS JOIN tenants t`);
    await q.query(`DELETE FROM feature_flags WHERE tenant_id IS NULL`);
    await q.query(`ALTER TABLE feature_flags ALTER COLUMN tenant_id SET NOT NULL`);
    await q.query(`ALTER TABLE feature_flags ADD PRIMARY KEY (tenant_id, key)`);

    // idempotency_keys: ключ належить користувачеві. Інакше два користувачі одного tenant з однаковим Idempotency-Key
    // (наприклад, "1" або "order-1") отримали б відповідь одне одного, тобто чуже замовлення. Наявні рядки (кеш повторів
    // за останню добу) видаляємо: власника ключа з них не відновити.
    await q.query(`DELETE FROM idempotency_keys`);
    await q.query(`ALTER TABLE idempotency_keys DROP CONSTRAINT idempotency_keys_pkey`);
    await q.query(`ALTER TABLE idempotency_keys ADD COLUMN user_id uuid NOT NULL REFERENCES users(id)`);
    await q.query(`ALTER TABLE idempotency_keys ADD PRIMARY KEY (tenant_id, user_id, key)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM idempotency_keys`);
    await q.query(`ALTER TABLE idempotency_keys DROP CONSTRAINT idempotency_keys_pkey`);
    await q.query(`ALTER TABLE idempotency_keys DROP COLUMN user_id`);
    await q.query(`ALTER TABLE idempotency_keys ADD PRIMARY KEY (tenant_id, key)`);

    // Повернення до глобальних прапорців: з кількох копій одного ключа лишається одна (довільна).
    await q.query(`ALTER TABLE feature_flags DROP CONSTRAINT feature_flags_pkey`);
    await q.query(`DELETE FROM feature_flags a USING feature_flags b WHERE a.key = b.key AND a.ctid > b.ctid`);
    await q.query(`ALTER TABLE feature_flags DROP COLUMN tenant_id`);
    await q.query(`ALTER TABLE feature_flags ADD PRIMARY KEY (key)`);

    await q.query(`DROP INDEX sent_emails_tenant_sent_idx`);
    await q.query(`ALTER TABLE sent_emails DROP COLUMN tenant_id`);

    await q.query(`DROP INDEX audit_log_tenant_entity_idx`);
    await q.query(`ALTER TABLE audit_log DROP COLUMN tenant_id`);
    await q.query(`CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id, at)`);
  }
}
