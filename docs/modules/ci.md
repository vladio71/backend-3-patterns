# CI: lint, build, unit, e2e

Код: `.github/workflows/ci.yml`, конфіги `jest.unit.config.js`, `jest.e2e.config.js`, `test/e2e/env.ts`.

## Проблема

Розробник змінив `OrdersService`, локально "все працює", відкрив PR. Через два дні з'ясувалось, що e2e-тест на outbox падає, бо він запускав лише unit. Ще через день інший PR зламав збірку TypeScript, але це помітили лише при деплої.

## Наївне рішення і де воно ламається

"Перед merge запускай усі тести локально". Сценарій: тести e2e потребують Postgres і Redis, у когось локально Postgres 14 і старий Redis, у когось немає Docker. Тести "падають у мене", і їх починають пропускати.

## Правильне рішення

Один workflow на кожен push і PR з чотирма кроками по порядку: `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e`. Postgres 16 і Redis 7 піднімаються як service containers GitHub Actions з healthcheck, тому e2e бачать ту саму версію, що й production у `docker-compose.yml`.

```
job checks
  services: postgres:16 (patterns_test), redis:7
  steps: checkout -> setup-node 22 (cache npm) -> npm ci
         -> lint -> build -> unit -> e2e (TEST_DB_PORT=5432, TEST_REDIS_PORT=6379)
```

`test/e2e/env.ts` читає `TEST_*` змінні, тому локально ті самі тести можна запустити на будь-якому порту: `TEST_DB_PORT=54333 TEST_REDIS_PORT=6391 npm run test:e2e`. Тести ходять у Redis з `REDIS_DB=1`, щоб не ділити черги з worker-ом, який, можливо, запущений на тій самій машині.

`globalSetup` проганяє міграції на `patterns_test` один раз перед усіма suites. Кожен suite реєструє власний tenant зі свіжим slug, тому дані різних suites не перетинаються, і базу між ними чистити не треба.

## Тест, який це доводить

Сам workflow: зелений прогін означає, що лінт, збірка, 11 unit і 47 e2e тестів пройшли на чистій машині. Локально те саме дають чотири команди з README.

## Спробуй сам

1. Додай крок `docker build .` у CI, щоб ламання Dockerfile теж ловилось до деплою.
2. Додай job `deploy`, який після зеленого `checks` на `main` робить `docker compose pull && up -d` на VPS через SSH (див. `docs/deploy.md`). Секрети в GitHub Secrets.
