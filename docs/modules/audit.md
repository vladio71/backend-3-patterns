# Soft delete і audit log

Код: `src/modules/audit/` (підписник, сервіс, контролер), `src/modules/products/` (видалення і відновлення), міграція `1730000000000-Init.ts` (частковий індекс).

## Проблема

Менеджер видалив товар, на який посилаються 300 замовлень за минулий рік. Через день бухгалтерія питає, що саме було в замовленні 4821. Через тиждень той самий менеджер каже, що видалив не той товар, і просить повернути. А служба підтримки хоче знати, хто змінив ціну у вівторок.

## Наївне рішення і де воно ламається

`DELETE FROM products WHERE id = ...`. Ламається одразу: `order_items.product_id` має зовнішній ключ, Postgres відмовить. Якщо зняти ключ або поставити `ON DELETE CASCADE`, зникнуть позиції замовлень.

Історія змін "на клієнті": фронтенд після кожного PATCH шле ще один запит `POST /history`. Сценарій: PATCH пройшов, вкладку закрили, `POST /history` не відправився. Або запис зробили через psql чи через інший сервіс, а не через цей фронтенд. Журнал неповний, і довіряти йому не можна.

## Правильне рішення

Soft delete: колонка `deleted_at`. `DELETE /products/:id` ставить `deleted_at = now()`, `POST /products/:id/restore` повертає `NULL`. TypeORM через `@DeleteDateColumn` сам додає `WHERE deleted_at IS NULL` у `find`, `findOne`, тому видалені товари не з'являються в списках і дають 404 по id.

Що soft delete ламає: унікальність. `UNIQUE (tenant_id, sku)` не дасть створити новий товар із sku видаленого. Рішення: частковий унікальний індекс, який бачить лише живі рядки:

```sql
CREATE UNIQUE INDEX products_tenant_sku_live_uq
    ON products (tenant_id, sku)
 WHERE deleted_at IS NULL;
```

Побічний ефект: якщо sku видаленого товару вже зайняв новий, відновити старий не можна. `restore` ловить `23505` і повертає 409 `SKU_TAKEN`.

Audit на сервері: `AuditSubscriber` це TypeORM `EntitySubscriberInterface` для `Product` і `Order`. Він реагує на `afterInsert`, `afterUpdate`, `afterSoftRemove`, `afterRecover` і пише рядок в `audit_log` через `event.manager`, тобто в тій самій транзакції. Якщо зміна відкотилась, запис у журналі відкотився разом з нею.

```
audit_log: tenant_id | entity | entity_id | action      | before        | after         | user_id | request_id | at
           product| 7f3...    | update      | {name:'до'}   | {name:'після'}| 1a2...  | req-1      | ...
           product| 7f3...    | soft_delete | {deletedAt:null}| {deletedAt:...}| ...
```

`tenant_id` береться з самої сутності (`after.tenantId`), тому рядок журналу належить тому tenant, що й товар. `GET /audit` фільтрує за tenant із контексту запиту: admin іншого магазину з чужим `entityId` отримує порожній список (не 403, як і скрізь), і журнал ніколи не віддає `before`/`after` чужого tenant. Індекс `audit_log (tenant_id, entity, entity_id, at)` починається з tenant, як усі складені індекси.

`user_id` і `request_id` беруться з `RequestContext` (AsyncLocalStorage), який заповнили middleware і JWT guard. Підписнику не треба нічого передавати.

Межа підписника: `afterUpdate` для `manager.update()` чи QueryBuilder отримує лише set-частину без id і без старого стану. Тому `ProductsService.update` (QueryBuilder заради перевірки version) пише журнал явно через `AuditService.record` в тій самій транзакції.

Чому не на клієнті: клієнтів багато (веб, мобільний, інший сервіс, psql), а база одна. Журнал у транзакції гарантує, що немає зміни без запису і запису без зміни.

## Тест, який це доводить

`test/e2e/audit.e2e-spec.ts`:

- "soft delete": після DELETE товар 404 по id і відсутній у `/v1/products`, присутній у `/products/deleted`; після restore знову 200.
- "частковий унікальний індекс": дубль sku 409; після soft delete той самий sku створюється; restore старого дає 409 `SKU_TAKEN`.
- "ізоляція": admin tenant A не бачить журнал товару tenant B (`test/e2e/multi-tenant.e2e-spec.ts`).
- "audit_log": для одного товару дії `['insert', 'update', 'soft_delete', 'restore']`; у `update` `before.name = 'до'`, `after.name = 'після'`, `userId` того, хто змінював, `requestId = 'req-patch-1'` з заголовка `X-Request-Id`.

## Спробуй сам

1. Додай у `GET /audit` пагінацію по `at` (cursor) і фільтр `?action=update`.
2. Зроби soft delete для замовлень і доведи тестом, що `GET /orders` їх не показує, а `audit_log` має `soft_delete`.

Попередня тема: [optimistic-lock](optimistic-lock.md) | Наступна тема: [multi-tenant](multi-tenant.md)
