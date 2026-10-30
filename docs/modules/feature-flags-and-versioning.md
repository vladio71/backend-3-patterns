# Feature flags і версіонування API

Код: `src/modules/feature-flags/`, версії в `src/modules/products/products.controller.ts`, `enableVersioning` у `src/setup-app.ts`.

## Проблема

Треба змінити форму відповіді `GET /products`: `price: 1999, currency: 'UAH'` стає `price: { amount: 1999, currency: 'UAH' }`, бо з'являються товари в різних валютах. Старий веб-фронтенд і мобільний застосунок у сторах читають `price` як число. Якщо просто змінити відповідь, у них `price.toFixed` упаде. Оновити всіх клієнтів одночасно неможливо.

## Наївне рішення і де воно ламається

Варіант 1: змінити форму і попросити всіх оновитись. Сценарій: мобільний застосунок версії минулого місяця у 30 % користувачів, у них зламався екран каталогу.

Варіант 2: `if (req.query.newFormat)`. Параметри розповзаються, через рік їх десять, і ніхто не знає, який клієнт що передає.

Варіант 3: увімкнути нову форму для всіх через конфіг і дивитись на помилки. Відкотити можна лише деплоєм.

## Правильне рішення

Дві незалежні речі.

### Версії URI

```
GET /v1/products  -> price: 1999, currency: 'UAH'       (стара форма, живе далі)
GET /v2/products  -> price: { amount: 1999, currency }  (нова форма)
GET /products     -> форма за прапорцем products-v2-default
```

Nest: `app.enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_NEUTRAL })`. У контролері три методи на один шлях: `@Version('1')`, `@Version('2')`, `@Version(VERSION_NEUTRAL)`. Решта контролерів без декоратора лишаються без префікса.

Порядок випуску breaking change:

1. Випустити `/v2`, `/v1` не чіпати. Нові клієнти йдуть на `/v2`.
2. Старі клієнти ходять на `/products` (без версії) або `/v1`. Їм нічого не змінилось.
3. Прапорець `products-v2-default` перемикає `/products` на нову форму поступово: спочатку allowlist з тестувальників, потім 10 %, потім 100 %.
4. Коли метрики показують, що `/v1` ніхто не кличе, видалити.

### Feature flags

Таблиця `feature_flags (key, enabled, percentage, allowlist)`. `FeatureFlagsService.isOn(key, userId)`:

```
enabled = false            -> false
userId в allowlist         -> true
percentage >= 100          -> true
hash(userId:key) % 100 < percentage -> true, інакше false
```

Хеш детермінований (sha256), тому один і той самий користувач завжди в одній групі: сторінка не "стрибає" між формами при кожному оновленні. Різні прапорці дають різні групи, бо key входить у хеш.

Кеш у Redis на 10 секунд (`FLAGS_CACHE_TTL_SEC`): база не отримує запит на кожен виклик `isOn`. `PUT /admin/flags/:key` видаляє ключ з кешу, тому зміна видна одразу, а не через 10 секунд.

## Тест, який це доводить

`test/e2e/feature-flags.e2e-spec.ts`:

- "percentage": для 6 користувачів `GET /flags/:key` дає `on === rolloutBucket(userId, key) < 40`, і повторний виклик дає те саме.
- "allowlist": при `percentage: 0` користувач з allowlist бачить `on: true`, інші `false`; `enabled: false` вимикає для всіх.
- "/v1 і /v2": у v1 `price` число і є `currency`; у v2 `price = { amount, currency }`.
- "/products без версії": без прапорця v1; після `PUT /admin/flags/products-v2-default` з allowlist одного користувача він бачить v2, інший v1.

`src/modules/feature-flags/feature-flags.service.spec.ts` (unit): `rolloutBucket` детермінований, у межах 0..99, при 30 % частка між 26 і 34 %.

## Спробуй сам

1. Додай заголовок `Deprecation: true` і `Sunset: <дата>` у відповіді `/v1/products` і напиши в README, як фронтенд має на них реагувати.
2. Зроби прапорець з параметром tenant: `enabled для tenant acme, вимкнено для globex`. Подумай, що має бути в хеші.

Попередня тема: [multi-tenant](multi-tenant.md) | Наступна тема: [files](files.md)
