# Endpoints

Усі, крім `auth/register`, `auth/login`, `payments/webhook` і `health`, вимагають `Authorization: Bearer <token>`. Позначка (admin) означає роль `admin`. Помилки мають форму `{ statusCode, code, message, requestId }`.

## auth

| Метод | Шлях | Що |
| --- | --- | --- |
| POST | `/auth/register` | `{ tenantSlug, email, password }`. Новий slug створює tenant, перший користувач стає admin. 201 `{ accessToken, user }` |
| POST | `/auth/login` | `{ tenantSlug, email, password }`. 201 `{ accessToken, user }` |
| GET | `/auth/me` | поточний користувач |

## products (multi-tenant, optimistic-lock, audit, versioning)

| Метод | Шлях | Що |
| --- | --- | --- |
| GET | `/v1/products` | список, `price` число, `currency` окремо |
| GET | `/v2/products` | список, `price: { amount, currency }` |
| GET | `/products` | форма за прапорцем `products-v2-default` для поточного користувача |
| GET | `/products/deleted` | (admin) soft-deleted товари |
| GET | `/products/:id` | товар; чужий tenant або видалений: 404 |
| POST | `/products` | (admin) `{ sku, name, priceCents, currency?, stock }`. Дубль sku: 409 `SKU_TAKEN` |
| PATCH | `/products/:id` | (admin) `{ version, name?, priceCents?, stock? }`. Стара version: 409 `STALE_VERSION` з `currentVersion` |
| DELETE | `/products/:id` | (admin) soft delete |
| POST | `/products/:id/restore` | (admin) відновити; sku зайнято: 409 `SKU_TAKEN` |

## files (зображення товарів)

| Метод | Шлях | Що |
| --- | --- | --- |
| POST | `/products/:id/images/presign` | (admin) `{ contentType: image/jpeg\|png\|webp, size }`. 201 `{ key, upload: { url, method, headers }, maxBytes }`. Більше 2 МБ: 413 |
| POST | `/products/:id/images/confirm` | (admin) `{ key }`. HEAD у сховище, запис у базу. 400 `OBJECT_NOT_UPLOADED`, `KEY_MISMATCH`, `ALREADY_CONFIRMED` |
| GET | `/products/:id/images` | список з presigned GET `url` |
| DELETE | `/products/:id/images/:imageId` | (admin) видалити з бази, потім зі сховища (помилка сховища не повертається клієнту, об'єкт лишається для прибирання) |

## orders (idempotency, outbox)

| Метод | Шлях | Що |
| --- | --- | --- |
| GET | `/orders` | admin: усі замовлення tenant, звичайний користувач: лише свої, з позиціями |
| GET | `/orders/:id` | одне замовлення; своє або, для admin, будь-яке в tenant, чуже дає 404 |
| POST | `/orders` | `{ items: [{ productId, qty }] }`. Заголовок `Idempotency-Key` необов'язковий: повтор віддає ту саму відповідь з `Idempotent-Replayed: true`; інше тіло з тим самим ключем 409 `IDEMPOTENCY_KEY_REUSED`. Ключ унікальний для пари (tenant, користувач). Пише `order.created` в outbox |

## payments (idempotency вебхука)

| Метод | Шлях | Що |
| --- | --- | --- |
| POST | `/payments/webhook` | публічний, заголовок `X-Signature` = HMAC-SHA256 hex сирого тіла. Тіло `{ eventId, type: 'payment.succeeded', orderId, amountCents, paymentRef? }`. 200 `{ duplicate, orderId, status }`. Невірний підпис: 401. Сума не збігається із сумою замовлення: 422 `AMOUNT_MISMATCH` |

## checkout (saga)

| Метод | Шлях | Що |
| --- | --- | --- |
| POST | `/checkout` | `{ items, address }`. Заголовки `X-Fail-Payment: 1` (відмова платежу), `X-Crash-After: reserve_stock\|charge_payment` (імітація падіння). 201 `{ sagaId, orderId, status, step, shipmentId }`. Відмова: 402 `CHECKOUT_FAILED`; провайдер недоступний: 503; немає товару: 409 |
| GET | `/checkout/sagas/:id` | стан саґи: step, status, compensationsDone, payload |

## flags (feature-flags-and-versioning)

| Метод | Шлях | Що |
| --- | --- | --- |
| GET | `/flags/:key` | `{ key, on }` для поточного користувача; прапорці окремі для кожного tenant |
| GET | `/admin/flags` | (admin) усі прапорці свого tenant |
| GET | `/admin/flags/:key` | (admin) один |
| PUT | `/admin/flags/:key` | (admin) `{ enabled, percentage 0..100, allowlist: userId[] }`, скидає кеш |
| DELETE | `/admin/flags/:key` | (admin) |

## audit

| Метод | Шлях | Що |
| --- | --- | --- |
| GET | `/audit?entity=product\|order&entityId=<uuid>` | (admin) журнал свого tenant: action, before, after, userId, requestId, at; чужий entityId дає `[]` |

## notifications

| Метод | Шлях | Що |
| --- | --- | --- |
| GET | `/notifications/emails?to=` | (admin) листи свого tenant з `sent_emails` |
| GET | `/notifications/dlq` | (admin) job-и в `notifications-dlq` поточного tenant |

## demo (circuit-breaker, notifications, profiling)

| Метод | Шлях | Що |
| --- | --- | --- |
| POST | `/demo/payment-provider` | (admin) `{ failing, latencyMs? }` стан фейкового провайдера (у Redis) |
| GET | `/demo/payment-provider/state` | `{ provider: { failing, latencyMs }, breaker: { impl, state, failures } }` |
| POST | `/demo/email-provider` | (admin) `{ failing }` |
| GET | `/demo/slow-report` | (admin) звіт з N+1: `{ timingMs, queries, rows }` |
| GET | `/demo/fast-report` | той самий звіт одним SQL |
| POST | `/demo/generate-orders?count=` | (admin) наповнити tenant замовленнями (до 20 000) |

## інше

| Метод | Шлях | Що |
| --- | --- | --- |
| GET | `/health` | `{ ok, db, redis }`; 200, коли все працює, і 503 з тим самим тілом, коли база або Redis недоступні |
| GET | `/reference` | Scalar, довідка API (запасний Swagger UI на `/docs`) |
| GET | `/queues` | Bull Board: `events`, `notifications`, `notifications-dlq` |
| GET | `/docs-json` | OpenAPI JSON |
