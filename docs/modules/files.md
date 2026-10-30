# Файли: presigned URL, байти не проходять через API

Код: `src/modules/files/` (порт `ObjectStorage`, адаптери `S3ObjectStorage` і `FakeObjectStorage`, сервіс, контролер).

## Проблема

Менеджер вантажить 2 МБ фото товару. Якщо файл іде через API (`multipart/form-data` на `POST /products/:id/images`), кожен байт проходить через Node: приймається, тримається в пам'яті або на диску, а потім ще раз відправляється в S3. 50 менеджерів одночасно, і API зайнятий перекачуванням файлів замість того, щоб відповідати на замовлення.

## Наївне рішення і де воно ламається

```ts
@Post(':id/images') @UseInterceptors(FileInterceptor('file'))
upload(@UploadedFile() file) { await s3.putObject(file.buffer) }
```

Сценарій: 20 паралельних завантажень по 2 МБ, у кожного `file.buffer` у пам'яті, плюс копія в SDK під час відправки. 80 МБ і вгору, GC працює безперервно, latency всіх інших запитів росте. Збільшити ліміт до 10 МБ на фото, і API падає з OOM.

Другий сценарій: API в одному регіоні, S3 в іншому, користувач у третьому. Файл робить два хопи замість одного.

## Правильне рішення

Браузер вантажить напряму в сховище, API лише видає дозвіл і записує результат:

```
браузер                     API                              S3 / MinIO
   | POST /products/:id/images/presign {contentType, size}
   |-------------------------->|
   |                           | перевірка: товар мій, size <= 2 МБ
   |                           | key = tenants/<t>/products/<p>/<uuid>.png
   |                           | presigned PUT URL (підписано: key, Content-Type, Content-Length)
   |<--------------------------|
   | PUT <url> з тими самими заголовками і байтами
   |------------------------------------------------------------>|
   |<------------------------------------------------------------| 200
   | POST /products/:id/images/confirm {key}
   |-------------------------->|
   |                           | HEAD key -> size, contentType           |
   |                           |---------------------------------------->|
   |                           | INSERT product_images
   |<--------------------------|
   | GET /products/:id/images -> [{ url: presigned GET, ... }]
```

Чому `confirm` окремо: API не бачить PUT і не знає, чи він відбувся. `HEAD` перевіряє, що об'єкт справді лежить і якого він розміру. Ключ мусить починатись з префікса цього товару, інакше можна було б "підтвердити" чужий файл.

Ліміт 2 МБ: presigned PUT підписує `Content-Length` (`ContentLength` у `PutObjectCommand`). Клієнт мусить надіслати рівно стільки байтів, інакше S3 відповість 403. `presign` відмовляє, якщо `size > MAX_IMAGE_BYTES`, а `confirm` перевіряє розмір ще раз після `HEAD` і видаляє об'єкт, якщо він більший (на випадок, якщо URL отримали в обхід API).

Порт і адаптери: `ObjectStorage` це інтерфейс з чотирма методами (`presignPut`, `presignGet`, `head`, `remove`). `S3ObjectStorage` використовує `@aws-sdk/client-s3` і `getSignedUrl`. `FakeObjectStorage` тримає `Map` у пам'яті; метод `upload(key, size, contentType)` у тестах грає роль браузера. Вибір через `STORAGE_DRIVER=s3|fake`.

### MinIO локально, S3 у production

`docker-compose.yml` піднімає `minio` (S3 API на 9000, консоль на 9001) і одноразовий `minio-init` на `minio/mc`, який створює бакет `product-images`. Код той самий. Щоб перейти на AWS S3, коли акаунт схвалять, у `.env` змінюються чотири змінні:

```
S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com   (або порожньо)
S3_REGION=eu-central-1
S3_ACCESS_KEY_ID=<IAM access key>
S3_SECRET_ACCESS_KEY=<IAM secret>
```

плюс `S3_FORCE_PATH_STYLE=false` (MinIO хоче `http://host/bucket/key`, AWS хоче `https://bucket.s3.region.amazonaws.com/key`). На бакеті в AWS потрібен CORS з `PUT` і `GET` для домену фронтенду, інакше браузер заблокує PUT.

## Тест, який це доводить

`test/e2e/files.e2e-spec.ts` (з `FakeObjectStorage`):

- "presign": URL з методом PUT, заголовки `Content-Type` і `Content-Length`, ключ з префіксом `tenants/<tenant>/products/<product>/`, `maxBytes = 2097152`.
- "presign відмовляє файлу більшому за 2 МБ": 413 `IMAGE_TOO_LARGE`.
- "confirm": до завантаження 400 `OBJECT_NOT_UPLOADED`; після `storage.upload(key, 500, 'image/jpeg')` 201 з `size: 500`; повторний confirm 400 `ALREADY_CONFIRMED`; у списку presigned GET.
- "confirm чужого ключа": ключ іншого товару дає 400 `KEY_MISMATCH`.
- "файл більший за ліміт в обхід presign": 413 і об'єкт видалено.

`S3ObjectStorage` проти MinIO або AWS автоматичними тестами тут не перевіряється: для цього потрібен docker compose.

## Спробуй сам

1. Додай `DELETE /products/:id/images/:imageId` з видаленням об'єкта в сховищі (метод уже є в порті) і прибирання "сиріт": об'єктів, для яких `confirm` не прийшов за 1 годину (підказка: записувати presign у таблицю `pending_uploads`).
2. Зроби обробку зображення після confirm: worker бере job `image.uploaded`, читає оригінал, кладе поруч мініатюру `..._thumb.jpg`.

Попередня тема: [feature-flags-and-versioning](feature-flags-and-versioning.md) | Наступна тема: [notifications](notifications.md)
