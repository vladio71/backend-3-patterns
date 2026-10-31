# Деплой

Той самий підхід, що й в основному проєкті: `docker compose` на одній машині.

1. VPS (Hetzner, DigitalOcean) або AWS EC2 free tier (t2.micro/t3.micro, Ubuntu 24.04). Відкрити порти 22 і 3002 (або 80, якщо поставити nginx перед API).
2. Встановити Docker: `curl -fsSL https://get.docker.com | sh`.
3. Клонувати репозиторій, скопіювати `.env.example` у `.env`. У `.env` задати `NODE_ENV=production`, свої `JWT_SECRET` і `PAYMENT_WEBHOOK_SECRET` (з типовими значеннями сервіс у production не стартує), а також паролі: `DB_USER`, `DB_PASSWORD`, `DB_NAME` для Postgres і `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` для MinIO. У `docker-compose.yml` ці значення записані як `${DB_PASSWORD:-patterns}`, тобто compose бере їх з `.env`, а типові лишаються лише для локального стенду. Паролі Postgres і MinIO записуються у volume при першому старті, тому задайте їх ДО першого `docker compose up`; змінити пізніше можна лише разом із даними (`docker compose down -v`).
4. `docker compose up --build -d`. Міграції виконує сервіс `api` перед стартом, бакет створює `minio-init`.
5. Seed (демо-дані: tenants `acme` і `globex`, користувачі з паролем `password123`) запускає сама команда сервісу `api` при кожному старті: `node dist/scripts/seed.js`, це скомпільована версія. Вона ідемпотентна, а при `NODE_ENV=production` пропускається, якщо в базі вже є хоч один tenant, тож на живу базу не впливає. Але на ПОРОЖНІЙ базі в production перший старт створить демо-користувачів з відомим паролем. Для справжнього сервера приберіть `node dist/scripts/seed.js &&` з `command` сервісу `api` у `docker-compose.yml` і зареєструйте першого admin через `POST /auth/register`.
6. Перевірити: `curl http://<ip>:3002/health`, довідка `/reference`, черги `/queues`.
7. Оновлення: `git pull && docker compose up --build -d`. Postgres, Redis і MinIO тримають дані у volumes, тому перезбірка їх не чіпає.
8. Якщо акаунт AWS схвалили: замінити MinIO на S3 через чотири змінні з `docs/modules/files.md`, сервіси `minio` і `minio-init` прибрати з compose.
