# Трейсинг: OpenTelemetry і Jaeger

## Що це

Логи відповідають на питання "що сталося", трейс відповідає на питання "де пройшов час". Один HTTP-запит у patterns проходить через express, десятки SQL-запитів, Redis, платіжного провайдера; worker окремо обробляє outbox і листи. Трейс збирає все це в одне дерево з таймінгами.

- **Trace (трейс)**: один наскрізний шлях однієї операції, наприклад `POST /checkout` від приходу запиту до відповіді. Має `traceId`.
- **Span (спан)**: один крок усередині трейсу з початком, кінцем і атрибутами: `POST /checkout` (весь запит), `pg.query:INSERT` (один SQL), `hget` (одна команда Redis), `payment.charge` (виклик провайдера). У кожного span-у є батько, тому вони складаються в дерево.

Схематично трейс одного checkout з провайдером, який відповідає 1.5 с:

```
POST /checkout                            1625 мс   (api)
  middleware - jsonParser                    1 мс
  request handler - /checkout             1620 мс
    pg.query:START                           1 мс   транзакція кроку reserve_stock
    pg.query:UPDATE                          2 мс   stock = stock - qty
    pg.query:COMMIT                          1 мс
    payment.charge                        1503 мс   <- ось де час
    pg.query:INSERT                          2 мс   payments
    pg.query:INSERT                          2 мс   shipments
```

Як це зроблено:

- `src/tracing.ts`: перший `import` у `main.ts` і `worker.ts`. Вмикає `NodeSDK` з авто-інструментаціями `http`, `express`, `pg`, `ioredis` і OTLP/HTTP-експортер. Без `OTEL_EXPORTER_OTLP_ENDPOINT` файл нічого не робить, а всі виклики `@opentelemetry/api` у коді стають no-op.
- `src/modules/payments/payment.client.ts`: ручний span `payment.charge` з атрибутами `payment.order_id`, `payment.amount_cents`, `breaker.state`. Провайдер фейковий (без HTTP), авто-інструментація його не бачить, і без цього span-у в трейсі була б просто порожня діра на `latencyMs`. Так само можна обгорнути будь-який свій крок.
- Невдалий експорт (Jaeger не піднятий, неправильний endpoint) пишеться у stderr один раз і не впливає на роботу API.

## Як запустити

```
docker compose up --build
```

Compose піднімає `jaeger` (образ `jaegertracing/jaeger:2.22.0`, all-in-one, дані в пам'яті) і передає `api` і `worker` змінну `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318` та `OTEL_SERVICE_NAME` (`api`, `worker`). Jaeger UI: http://localhost:16686.

Без Docker для застосунку: підняти лише Jaeger (`docker compose up jaeger`) і у `.env` поставити `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`. Для `npm run dev:worker` ще `OTEL_SERVICE_NAME=worker`, інакше обидва процеси назвуться `patterns`.

Span-и йдуть у Jaeger пачками кожні 5 секунд, тому трейс з'являється в UI із затримкою до 5 с.

## Jaeger UI за 30 секунд

1. Зліва вгорі **Service**: обрати `api` (або `worker`).
2. **Operation**: обрати конкретний ендпоінт, наприклад `POST /checkout`, або лишити `all`.
3. **Find Traces**. Справа список трейсів, у кожного тривалість і кількість span-ів. Клік по трейсу відкриває дерево.
4. У дереві кожен рядок це span, горизонтальна смужка показує, коли він почався і скільки тривав відносно батька. Клік по рядку розкриває атрибути (`db.statement` для SQL, `http.status_code` для HTTP) і помилки.
5. Поля **Min Duration** / **Max Duration** фільтрують трейси за тривалістю: `Min Duration = 1s` показує лише повільні.

## Прохід 1: знайти повільний крок у POST /checkout

1. Залогінитись адміном tenant-а (після `npm run seed` це `admin@acme.test` / `password123`, `tenantSlug: acme`), взяти id будь-якого товару і зробити провайдера повільним:

   ```
   TOKEN=$(curl -s -X POST localhost:3002/auth/login -H 'content-type: application/json' \
     -d '{"tenantSlug":"acme","email":"admin@acme.test","password":"password123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
   PRODUCT_ID=$(curl -s localhost:3002/products -H "authorization: Bearer $TOKEN" | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].id')
   curl -s -X POST localhost:3002/demo/payment-provider -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"failing":false,"latencyMs":1500}'
   curl -s -X POST localhost:3002/checkout -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
     -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"qty\":1}],\"address\":\"Миколаїв\"}"
   ```

2. У Jaeger: Service `api`, Operation `POST /checkout`, Find Traces, відкрити найновіший трейс. Тривалість близько 1.6 с.
3. У дереві під `request handler - /checkout` йдуть три кроки саґи. SQL-span-и (`pg.query:START`, `UPDATE`, `INSERT`, `COMMIT`) по 1-3 мс кожен, а між ними один span `payment.charge` на 1500 мс. Це і є повільний крок. Клік по ньому: атрибути `payment.amount_cents`, `breaker.state: closed`.
4. Повторити з заголовком `X-Fail-Payment: 1`: span `payment.charge` стане червоним (провайдер відмовив), після нього з'являться SQL-span-и компенсації (повернення stock), а весь запит матиме `http.status_code: 402`.
5. Зробити провайдера таким, що падає (`{"failing":true,"latencyMs":300}`), і зробити 6 checkout поспіль: перші п'ять `payment.charge` тривають по 300 мс і червоні (503 `PAYMENT_PROVIDER_ERROR`), шостий триває менше мілісекунди з `breaker.state: open`, бо breaker відкритий і до провайдера вже не ходить (503 `PAYMENT_UNAVAILABLE`). Це та сама картина, що в [modules/circuit-breaker.md](modules/circuit-breaker.md), але в часі, а не в лічильниках.

Потім повернути провайдера: `{"failing":false,"latencyMs":0}`.

## Прохід 2: побачити N+1 у GET /demo/slow-report

`GET /demo/slow-report` рахує продажі по товарах окремим запитом на кожен товар і ще одним на кожну позицію (модуль profiling). `GET /demo/fast-report` робить те саме одним SQL.

1. Наповнити tenant замовленнями і зробити обидва звіти:

   ```
   curl -s -X POST "localhost:3002/demo/generate-orders?count=500" -H "authorization: Bearer $TOKEN"
   curl -s localhost:3002/demo/slow-report -H "authorization: Bearer $TOKEN" | head -c 60
   curl -s localhost:3002/demo/fast-report -H "authorization: Bearer $TOKEN" | head -c 60
   ```

2. У Jaeger: Service `api`, Operation `GET /demo/slow-report`, Find Traces, відкрити трейс. У правому верхньому куті кількість span-ів: сотні або тисячі. Під `request handler` довгий "частокіл" з пар `pg-pool.connect` і `pg.query:SELECT`, усі по 1-2 мс, усі послідовно, один за одним. Жоден окремо не повільний, повільна їхня кількість. Це і є N+1 очима трейсу: не "один довгий span", а "тисяча коротких".
3. Відкрити трейс `GET /demo/fast-report` поруч: один `pg.query:SELECT` на кілька мілісекунд і все.
4. Клік по будь-якому `pg.query:SELECT` у повільному трейсі розкриває `db.statement`: видно сам SQL (`SELECT ... FROM order_items WHERE product_id = $1`), тобто одразу зрозуміло, який саме `find` у циклі це робить.

Для порівняння `timingMs` і `queries` у відповіді звіту дають ті самі числа, але лише сумарно; трейс показує, з чого вони складаються.

## Типові питання

- **Трейсів немає.** Перевірити, що у логах API при старті є рядок `[tracing] увімкнено, span-и йдуть на ...`. Якщо немає, змінна `OTEL_EXPORTER_OTLP_ENDPOINT` порожня. Якщо є, але Jaeger порожній: у stderr буде `[tracing] не вдалося відправити span-и ...` з причиною (неправильний host, Jaeger не піднятий).
- **У сервісі `worker` багато коротких трейсів з одного `pg.query:SELECT`.** Це опитування: `OutboxRelay` кожну секунду читає outbox, `SagaResumer` шукає зависли саґи. Інструментація `pg` створює span і без батьківського span-у, тому кожен такий запит стає окремим трейсом. Для фільтрації у Jaeger корисно ставити `Min Duration`.
- **Чому не всі Redis-команди видно.** Інструментація `ioredis` створює span лише всередині іншого активного span-у (`requireParentSpan`). Фонове опитування черг BullMQ воркером до жодного запиту не належить і в трейси не потрапляє, це навмисно.
- **У тестах трейсинг заважає?** Ні: e2e не виставляють `OTEL_EXPORTER_OTLP_ENDPOINT`, SDK не стартує, ручні span-и стають no-op.
