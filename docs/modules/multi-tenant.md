# Мультитенантність: tenant_id у кожній таблиці

Код: `src/common/request-context.ts`, `src/common/tenant-scoped.repository.ts`, JWT guard у `src/modules/auth/jwt-auth.guard.ts`.

## Проблема

Один сервіс обслуговує кілька магазинів (tenants): ACME і Globex. У кожного свої товари, замовлення, користувачі. Користувач ACME не має побачити жодного рядка Globex, навіть якщо вгадає id. Розробник додає новий endpoint `GET /orders/stats` і забуває фільтр по магазину. Витік даних між клієнтами.

## Наївне рішення і де воно ламається

У кожному сервісі вручну: `repo.find({ where: { tenantId: req.user.tenantId } })`. Працює рівно до першого забутого `where`. Сценарій: `GET /products/:id` реалізовано як `repo.findOne({ where: { id } })`. Користувач tenant A підставляє id товару tenant B і бачить його. Ще гірше, якщо повернути 403: клієнт дізнається, що запис існує.

## Правильне рішення

Три частини.

1. Джерело tenant: JWT claim `tenantId`. `JwtAuthGuard` перевіряє токен і кладе `tenantId`, `userId`, `role` у `RequestContext`. Контекст живе в `AsyncLocalStorage`, тобто він свій для кожного запиту і доступний у будь-якому сервісі без передачі параметрів.

2. `TenantScopedRepository<T>`: обгортка над репозиторієм TypeORM, яка в кожен запит додає `tenant_id = <поточний>`:

```ts
findOneById(id)  -> findOne({ where: { id, tenantId: ctx.tenantIdOrFail() } })
find(where)      -> find({ where: { ...where, tenantId } })
create(data)     -> create({ ...data, tenantId })
save(entity)     -> кидає помилку, якщо entity.tenantId інший
```

Сервіси (`ProductsService`, `OrdersService`, `FilesService`) бачать лише цю обгортку. Забути фільтр неможливо, бо його нема де забувати. Без tenant у контексті `tenantIdOrFail()` кидає помилку, а не повертає все.

3. Чужий id це 404, не 403. `findOneById` повертає `null` і для неіснуючого, і для чужого запису. Відповідь однакова, існування не витікає.

### runWithTenant і raw()

`RequestContext` наповнюється JWT-guard-ом, тобто лише в HTTP-запиті. У worker-і запиту немає, а `tenantIdOrFail()` без контексту кидає помилку. Для цього є `runWithTenant(ctx, tenantId, userId, fn)` (`src/common/request-context.ts`): вона відкриває `AsyncLocalStorage`-контекст "від імені" tenant, і все, що викликає `fn`, бачить цей tenant так само, як в HTTP-запиті. `SagaResumer` бере зависшу саґу з її `tenant_id` і виконує крок усередині `runWithTenant`. Користувача там немає (`userId = null`, роль `null`), тому audit-запис від worker-а має `user_id = NULL`.

`TenantScopedRepository.raw()` повертає звичайний `Repository` без фільтра. Це свідомий вихід за огорожу для випадків, де обгортка не вміє потрібного запиту (QueryBuilder для `listDeleted`). Правило: з `raw()` умову `tenant_id` пишеш сам. Видалення чи оновлення за голим `id` без `tenant_id` під `raw()` це саме той забутий `where`, від якого обгортка захищає, тому в `FilesService.remove` видалення йде з `{ id, tenantId }`.

Індекси: кожен складений індекс починається з `tenant_id` (`products (tenant_id, created_at)`, `orders (tenant_id, status)`), бо кожен запит має цю умову першою. Унікальні ключі теж у межах tenant: `users (tenant_id, email)`, `products (tenant_id, sku) WHERE deleted_at IS NULL`.

### Які таблиці глобальні (без tenant_id) і чому

Не кожна таблиця належить tenant. Нині без `tenant_id` п'ять таблиць:

```
таблиця                    чому без tenant_id
processed_webhook_events   вебхук публічний: на вході немає JWT і tenant невідомий, доки не знайдено замовлення.
                           event_id це id події провайдера, глобально унікальний; за ним лише відсікаємо дубль
consumed_events            event_id це uuid з outbox_events, глобально унікальний; ідемпотентність споживача
                           не залежить від tenant
audit_log, sent_emails,    глобальні поки що: це відома прогалина, а не рішення. Адмін одного tenant
feature_flags              бачить журнал, листи й прапорці всіх tenant. Виправляє наступна міграція
                           (tenant_id у цих трьох таблицях)
```

Перші дві глобальні назавжди й свідомо: їхній ключ це id події, а не дані магазину. Решта таблиць (`products`, `orders`, `payments`, `shipments`, `checkout_sagas`, `outbox_events`, `idempotency_keys`, `product_images`, `users`) мають `tenant_id`; `order_items` захищена через `order_id`.

### Три способи ізоляції

```
                      одна БД, tenant_id        схема на tenant           БД на tenant
ізоляція              логічна (код)             середня (search_path)     повна
міграції              одна                      по одній на схему         по одній на БД
кількість tenants     тисячі                    сотні                     десятки
з'єднання з БД        один пул                  один пул                  пул на tenant
"шумний сусід"        так, спільні ресурси      так                       ні
бекап одного tenant   складно (фільтр)          pg_dump -n schema         pg_dump
коли                  SaaS з багатьма           коли клієнт вимагає       банки, медицина,
                      малими клієнтами          окремого dump             вимога регулятора
```

Тут обрано перший варіант: один магазин-SaaS з багатьма клієнтами. Postgres Row Level Security був би другим шаром захисту поверх коду, але без нього код лишається зрозумілішим для читача.

## Тест, який це доводить

`test/e2e/multi-tenant.e2e-spec.ts`:

- "список містить лише свої товари": tenant A і B створили товар з однаковим sku; `/v1/products` кожного містить лише свій.
- "чужий id це 404": GET, PATCH, DELETE і `GET /products/:id/images` з id товару B під токеном A дають 404.
- "замовлення з чужим товаром не створюється": 404.
- "GET /orders": звичайний користувач бачить лише свої замовлення, admin усі замовлення tenant, чужий tenant нічого.
- "без токена 401".

## Спробуй сам

1. Додай Row Level Security: `ALTER TABLE products ENABLE ROW LEVEL SECURITY` і політику по `current_setting('app.tenant_id')`. Встанови цю змінну на початку кожної транзакції. Перевір, що навіть "сирий" `dataSource.query('SELECT * FROM products')` без фільтра повертає лише свій tenant.
2. Зроби endpoint `GET /admin/tenants/:id/stats` для суперадміна, який не належить жодному tenant, і подумай, як `TenantScopedRepository` має поводитись у цьому випадку.

Попередня тема: [audit](audit.md) | Наступна тема: [feature-flags-and-versioning](feature-flags-and-versioning.md)
