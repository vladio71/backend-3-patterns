# Ідемпотентність: вебхук і Idempotency-Key

Код: `src/modules/payments/` (вебхук), `src/modules/orders/idempotency.interceptor.ts` (заголовок).

## Проблема

Платіжний провайдер надсилає вебхук "оплата пройшла". Мережа моргнула, провайдер не отримав 200 і надіслав ту саму подію ще раз, а потім ще раз через хвилину. Якщо обробник просто "позначити замовлення оплаченим і створити платіж", ми отримаємо два рядки платежу і подвійний лист клієнту.

Те саме з фронтендом: користувач натиснув "Оформити" двічі, бо кнопка не заблокувалась. Два замовлення.

## Наївне рішення і де воно ламається

```ts
const seen = await repo.findOne({ where: { eventId } });
if (seen) return { duplicate: true };
await markPaid(orderId);
await repo.save({ eventId });
```

Сценарій, де це ламається: провайдер надсилає 8 копій однієї події паралельно (так буває при retry-штормі). Усі 8 запитів виконують `findOne` одночасно, усі бачать "немає", усі викликають `markPaid`. Перевірка і запис рознесені в часі, між ними є вікно.

Друга проблема: `markPaid` відпрацював, а `repo.save` упав (база відвалилась). Повторна доставка знову все застосує.

## Правильне рішення

Таблиця `processed_webhook_events` з `event_id` як первинним ключем. Вставка в неї робиться ПЕРШОЮ дією в тій самій транзакції, що й зміна замовлення (`src/modules/payments/payments.service.ts`):

```
BEGIN
  INSERT INTO processed_webhook_events (event_id) VALUES ('evt_1')   -- 1
  SELECT ... FROM orders WHERE id = ... FOR UPDATE                     -- 2
  UPDATE orders SET status = 'paid'                                    -- 3
  INSERT INTO payments ...                                             -- 4
  INSERT INTO outbox_events (type = 'order.paid')                      -- 5
COMMIT
```

Що робить Postgres при 8 паралельних запитах з одним `event_id`:

```
запит 1: INSERT event_id='evt_1'  -> проходить, тримає рядок до COMMIT
запити 2..8: INSERT event_id='evt_1' -> чекають на запит 1
запит 1: COMMIT
запити 2..8: помилка 23505 unique_violation -> транзакція відкочується
```

Обробник ловить `23505` і повертає `200 { duplicate: true }`. Саме 200, а не 409: провайдеру треба сказати "я отримав, не повторюй".

Підпис: `X-Signature` це HMAC-SHA256 над сирим тілом (`rawBody: true` в `main.ts`). Порівняння через `timingSafeEqual` (`webhook-signature.ts`), щоб час відповіді не залежав від того, скільки перших байтів збіглося.

`Idempotency-Key` на `POST /orders` (`idempotency.interceptor.ts`) працює так само, але зберігає ще й відповідь:

```
INSERT INTO idempotency_keys (tenant_id, key, request_hash)   -- 23505 означає "ключ уже був"
  той самий hash і є відповідь -> віддати її з заголовком Idempotent-Replayed: true
  той самий hash, відповіді ще немає -> 409 IDEMPOTENCY_IN_PROGRESS
  інший hash -> 409 IDEMPOTENCY_KEY_REUSED
```

`request_hash` це sha256 тіла. Без нього клієнт міг би випадково прислати інше замовлення під старим ключем і отримати чужу відповідь.

## Тест, який це доводить

`test/e2e/idempotency.e2e-spec.ts`:

- "та сама подія двічі послідовно": перша відповідь `duplicate: false, status: paid`, друга `duplicate: true`, у `payments` один рядок.
- "та сама подія 8 разів паралельно": усі 8 відповідей 200, рівно одна з `duplicate: false`, один рядок `payments`, одна подія `order.paid` в outbox.
- "Idempotency-Key": повтор віддає той самий `id` замовлення і заголовок `Idempotent-Replayed: true`; інше тіло з тим самим ключем дає 409.

## Спробуй сам

1. Додай TTL для `idempotency_keys`: ключ старший за 24 години можна використати знову. Напиши міграцію з індексом по `created_at` і тест.
2. Зроби так, щоб `409 IDEMPOTENCY_IN_PROGRESS` не повертався одразу, а чекав до 2 секунд на завершення першого запиту і віддавав його відповідь.
