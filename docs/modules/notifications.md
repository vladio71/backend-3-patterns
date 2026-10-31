# Сповіщення: черга, retry, dead-letter

Код: `src/modules/notifications/` (сервіс, `EmailWorker`, `FakeEmailProvider`), споживач `order.paid` у `src/modules/outbox/events.consumer.ts`, Bull Board у `src/setup-app.ts`.

## Проблема

Після оплати клієнту має прийти лист. SMTP-сервер іноді відповідає 5 секунд, іноді помилкою "спробуйте пізніше". Якщо слати лист прямо з обробника вебхука, провайдер платежів чекатиме на наш SMTP, а при помилці SMTP ми відповімо 500, і провайдер повторить вебхук, хоча оплату ми вже записали.

## Наївне рішення і де воно ламається

```ts
await markPaid(order);
await smtp.send(email);   // 5 секунд або помилка
```

Сценарій 1: SMTP упав на 10 хвилин. Усі вебхуки за ці 10 хвилин завершились 500. Оплати записані, листи ні, і нічого їх не надішле.

Сценарій 2: `setImmediate(() => smtp.send(email))`, "щоб не чекати". API-процес перезапустили під час деплою. Листи, що були в `setImmediate`, зникли разом із процесом.

Черга потрібна не тому, що "відправка повільна". Вона потрібна, бо лист МУСИТЬ піти, навіть якщо процес API помре через мілісекунду після того, як оплату записали.

## Правильне рішення

Ланцюжок, де кожна ланка переживає смерть попередньої:

```
webhook/checkout -> outbox (Postgres, та сама транзакція, що й оплата)
   -> relay -> черга events -> EventsConsumer: consumed_events + job 'email' у чергу notifications
   -> EmailWorker: FakeEmailProvider.send -> sent_emails
```

Job `email` у `notifications`: `attempts: 3`, `backoff: exponential, delay: EMAIL_BACKOFF_MS` (1 с). Три спроби означають дві паузи між ними: 1 с після першої невдачі, 2 с після другої. Після третьої невдачі чекати вже нема чого, job іде в DLQ (третьої паузи в 4 с не буде). `jobId = email-<eventId>`: повторна обробка події не створить другого листа.

Dead-letter: копію в `notifications-dlq` робить сам обробник (`EmailWorker.handle`) на останній спробі, коли `attemptsMade + 1 >= attempts`, і лише потім кидає помилку далі. Так зроблено не в слухачі події `failed`, бо слухач стріляє вже після того, як job позначено failed, і тільки в процесі, що його обробляв: якщо процес помре між цими двома моментами, job failed, а в DLQ його немає. В обробнику порядок інший: спершу копія з `failedReason`, потім помилка. Лист не зник, він лежить там, де його побачить людина (`GET /notifications/dlq`, Bull Board) і звідки його можна повторити після лагодження SMTP. `GET /notifications/dlq` показує лише листи поточного tenant: у job є `tenantId`. `GET /notifications/emails` теж фільтрує за tenant: у `sent_emails` є `tenant_id`. Він NULLABLE, бо лист може прийти без tenant (системний або зі старого job, поставленого до міграції); такі рядки не показує жоден tenant.

`FakeEmailProvider` пише в таблицю `sent_emails` замість SMTP. Перемикач "SMTP лежить" зберігається в Redis (`POST /demo/email-provider { failing: true }`), бо API і worker це різні процеси, і змінна в пам'яті API worker-у не видна.

Bull Board на `/queues` показує всі три черги: `events`, `notifications`, `notifications-dlq`, з job-ами у станах waiting, delayed (чекає backoff), failed, completed.

```
notifications: email-evt1 [completed]   email-evt2 [delayed, наступна спроба через 2 с]
notifications-dlq: dlq-email-evt3 { failedReason: 'SMTP недоступний', attempts: 3 }
```

## Тест, який це доводить

`test/e2e/notifications.e2e-spec.ts` (relay, consumer і email worker запущені в процесі тесту):

- "успішний checkout": після `POST /checkout` у `sent_emails` з'являється лист на email користувача з номером замовлення в темі і з `tenant_id` магазину; `GET /notifications/emails?to=...` його показує, а admin іншого tenant отримує порожній список навіть без фільтра.
- "провайдер падає": `failing: true`, job проходить 3 спроби (`attemptsMade = 3`), у `notifications-dlq` є job `dlq-<id>` з `attempts: 3` і причиною, у `sent_emails` листа немає, `GET /notifications/dlq` його містить, а адмін іншого tenant не бачить.

Unit-тест `email.worker.spec.ts` перевіряє момент копіювання: на 1-й і 2-й спробі DLQ порожній, на 3-й копія робиться до помилки.
- "провайдер падає лише раз": перша спроба невдала, перемикач вимкнено, retry з backoff доставляє лист, у DLQ нічого.

## Спробуй сам

1. Зроби `POST /notifications/dlq/:id/retry`: job з DLQ повертається в `notifications` з новим `attempts`, а з DLQ видаляється.
2. Додай другий тип job `sms` з власним провайдером і лімітом 1 job на секунду (BullMQ `limiter`). Перевір, що лист і SMS для одного замовлення не блокують один одного.

Попередня тема: [files](files.md) | Наступна тема: [outbox](outbox.md)
