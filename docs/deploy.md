# Деплой

Той самий підхід, що й в основному проєкті: `docker compose` на одній машині.

1. VPS (Hetzner, DigitalOcean) або AWS EC2 free tier (t2.micro/t3.micro, Ubuntu 24.04). Відкрити порти 22 і 3002 (або 80, якщо поставити nginx перед API).
2. Встановити Docker: `curl -fsSL https://get.docker.com | sh`.
3. Клонувати репозиторій, скопіювати `.env.example` у `.env`, замінити `JWT_SECRET`, `PAYMENT_WEBHOOK_SECRET`, паролі Postgres і MinIO.
4. `docker compose up --build -d`. Міграції виконує сервіс `api` перед стартом, бакет створює `minio-init`.
5. `docker compose exec api node -r ts-node/register/transpile-only scripts/seed.ts` не спрацює в production-образі (там немає dev-залежностей). Seed запускати з локальної машини з `DB_HOST=<ip сервера>` або не запускати зовсім.
6. Перевірити: `curl http://<ip>:3002/health`, довідка `/reference`, черги `/queues`.
7. Оновлення: `git pull && docker compose up --build -d`. Postgres, Redis і MinIO тримають дані у volumes, тому перезбірка їх не чіпає.
8. Якщо акаунт AWS схвалили: замінити MinIO на S3 через чотири змінні з `docs/modules/files.md`, сервіси `minio` і `minio-init` прибрати з compose.
