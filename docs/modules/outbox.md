# Outbox: подія не губиться разом із замовленням

Код: `src/modules/outbox/` (сервіс, relay, споживач), запис події в `src/modules/orders/orders.service.ts`.

## Проблема

Замовлення створено, і про це мають дізнатися інші частини системи: лист клієнту, склад, аналітика. Для цього ми кладемо подію `order.created` у чергу. Але черга живе в Redis, а замовлення в Postgres, і це дві різні системи, які не вміють робити одну транзакцію на двох.

## Наївне рішення і де воно ламається

```ts
await orders.save(order);          // Postgres
await queue.add('order.created');  // Redis
```

Сценарій 1: `save` пройшов, процес API упав (OOM, деплой, SIGKILL) перед `queue.add`. Замовлення є, події немає. Лист не піде ніколи, і ніхто цього не помітить.

Сценарій 2 (поміняли місцями): спочатку `queue.add`, потім `save`. `save` упав на constraint. Подія є, замовлення немає. Споживач отримує `order.created` для неіснуючого замовлення.

Сценарій 3: `save` виконано всередині транзакції, `queue.add` після нього, а `COMMIT` упав. Подія пішла, замовлення відкотилось.

У всіх трьох випадках "зберегти, потім опублікувати" дає неузгодженість, і її не можна полагодити порядком викликів.

## Правильне рішення

Подію пишемо в ТУ САМУ базу, в ТІЙ САМІЙ транзакції, що й замовлення. Таблиця `outbox_events`:

```
BEGIN
  INSERT INTO orders ...
  INSERT INTO order_items ...
  INSERT INTO outbox_events (type='order.created', payload={orderId}, published_at=NULL)
COMMIT
```

Або є і замовлення, і подія, або немає нічого. `OutboxService.append(manager, ...)` приймає `manager` транзакції саме для цього.

Публікацією займається окремий процес, relay (`outbox.relay.ts`, запускається в `src/worker.ts`). Раз на секунду:

```
BEGIN
  SELECT * FROM outbox_events WHERE published_at IS NULL
    ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED
  для кожного рядка:
    queue.add(type, data, { jobId: event.id })
    UPDATE outbox_events SET published_at = now()
COMMIT
```

`FOR UPDATE SKIP LOCKED` дозволяє запустити два worker-и: другий не чекає на рядки, які вже взяв перший, а бере наступні.

Якщо relay упав між `queue.add` і `COMMIT`, транзакція відкотиться, `published_at` лишиться `NULL`, і на наступному тику подія буде опублікована ще раз. Це означає доставку "щонайменше один раз", тому споживач мусить бути ідемпотентним.

Споживач (`events.consumer.ts`) робить це тією самою технікою, що і вебхук: `event_id` як первинний ключ у `consumed_events`, вставка в одній транзакції з ефектом. Повторна доставка падає на `23505` і пропускається. Плюс `jobId: event.id` у BullMQ: друга спроба `add` з тим самим id нічого не створює.

```
outbox_events          relay          BullMQ events        consumer            consumed_events
published_at=NULL  -> SELECT...   -> job(id=evt)      -> INSERT evt (PK)  -> ефект
                      FOR UPDATE                          дубль: 23505, skip
                      SKIP LOCKED
```

## Тест, який це доводить

`test/e2e/outbox.e2e-spec.ts`:

- "замовлення і подія order.created записані разом": після `POST /orders` рядок у `outbox_events` існує з `published_at = NULL`.
- "relay упав між INSERT і publish": `relay.failNextPublish = true` змушує `tick()` кинути помилку після вибірки; рядок досі `published_at = NULL`; наступний `tick()` публікує його, job з `id = event.id` є в черзі.
- "повторна доставка не повторює ефект": `consumer.handle(job)` двічі, перший раз `true`, другий `false`, у `consumed_events` один рядок.
- "повний шлях": relay publish, BullMQ worker, рядок у `consumed_events`.

## Спробуй сам

1. Додай у relay лічильник `attempts` і переносити подію в `outbox_dead` після 10 невдалих публікацій, щоб одна "отруйна" подія не блокувала решту.
2. Зроби споживача для `order.cancelled`: він має повертати товар на склад. Переконайся тестом, що подвійна доставка не повертає товар двічі.

Попередня тема: [notifications](notifications.md) | Наступна тема: [saga](saga.md)
