# Профілювання: від "повільно" до конкретного рядка

Код: `src/modules/demo/reports.service.ts` (`slowReport`, `fastReport`), endpoints `GET /demo/slow-report` і `GET /demo/fast-report`, міграція `1730000001000-AddOrderItemsProductIdx.ts`.

## Проблема

Звіт "продажі по товарах" працював секунду на тестових даних. У production 10 000 замовлень, і він відповідає 10 секунд. Nginx обриває з'єднання на 5 секунді. Менеджер натискає ще раз. Кожен клік це ще 10 секунд навантаження на базу.

## Наївне рішення і де воно ламається

Додати індекс "навмання" або кеш на 5 хвилин. Сценарій: індекс додали, стало 9.8 секунди замість 9.9. Кеш додали, перший користувач зранку чекає 10 секунд, а звіт за сьогодні показує вчорашні цифри. Без вимірювання невідомо, де саме час.

У `slowReport` навмисно три проблеми:

1. N+1: окремий `SELECT` по `order_items` на кожен товар і окремий `SELECT` по `orders` на кожну позицію.
2. Відсутній індекс по `order_items.product_id`.
3. JSON збирається рядком у циклі, а `orderIds.includes` робить O(n^2).

## Правильне рішення: як знайти

Крок 1. `console.time` навколо секцій. У `slowReport` таймер повертається у відповіді як `timingMs`, запити рахуються в `queries`.

Крок 2. Логер запитів TypeORM: `DB_LOGGING=true` у `.env`. Один виклик звіту друкує тисячі рядків `query: SELECT ... FROM "order_items"`. Це і є N+1: кількість запитів дорівнює кількості рядків, а не константі.

Крок 3. `EXPLAIN ANALYZE` на один із запитів, які повторюються:

```
без індексу (20 033 рядків у order_items):
 Seq Scan on order_items  (actual time=0.012..4.123 rows=1003 loops=1)
   Filter: (product_id = '3bbdf663-...'::uuid)
   Rows Removed by Filter: 19030
 Execution Time: 4.232 ms

з індексом order_items_product_idx:
 Bitmap Heap Scan on order_items  (actual time=0.099..1.086 rows=1003 loops=1)
   ->  Bitmap Index Scan on order_items_product_idx (actual time=0.067..0.067 rows=1003)
 Execution Time: 1.168 ms
```

Крок 4. `node --cpu-prof --cpu-prof-dir=prof dist/src/main.js`, один виклик `/demo/slow-report`, SIGTERM. Файл `.cpuprofile` відкривається в Chrome DevTools (вкладка Performance, кнопка Load) або в VS Code. Топ self time з реального профілю (10 000 замовлень):

```
total sampled: 12603 ms
  3748 ms  29.7 %  writev                       запис у сокет Postgres: 20 030 запитів
  2059 ms  16.3 %  (idle)                       очікування відповіді бази
   593 ms   4.7 %  (garbage collector)          20 000 об'єктів-сутностей і рядків JSON
   267 ms   2.1 %  addFields  pg/lib/result.js  розбір відповідей
   182 ms   1.4 %  replacePropertyNamesForTheWholeQuery  typeorm QueryBuilder
   168 ms   1.3 %  slowReport reports.service.js:27      сам цикл
```

Висновок з профілю: процесор майже не рахує, він пише і читає сокет 20 000 разів. Жоден алгоритм у циклі не врятує, треба прибрати запити.

## Виміряні числа

Tenant `acme`, 10 000 замовлень, 20 033 позицій, 20 товарів, локальний Postgres 16 (той самий хост).

```
                                   timingMs (3 виклики)          queries
slow-report, без індексу           8810 / 8701 / 10406           20 030
slow-report, з індексом            9842 / 9824 / 10117           20 030
fast-report (1 SQL з GROUP BY)     59 / 43 / 40                  1
```

Індекс прискорив окремий запит у 3.6 раза (4.2 мс до 1.2 мс), але на звіті цього не видно: 20 запитів по `order_items` це 60 мс економії на фоні 9 секунд, які з'їдають 20 010 запитів по `orders`. Порядок дій тому такий: спочатку прибрати N+1, потім дивитись індекси. `fastReport` робить один `SELECT ... LEFT JOIN (order_items JOIN orders) ... GROUP BY p.id` і повертає звичайний масив. 200 разів швидше.

Ті самі цифри в e2e на 300 замовленнях: slow 514 мс / 611 запитів, fast 4 мс / 1 запит.

## Тест, який це доводить

`test/e2e/profiling.e2e-spec.ts`: 10 товарів, `POST /demo/generate-orders?count=300`; обидва звіти повертають однакові `rows`; `fast.queries === 1`, `slow.queries > 100`; `fast.timingMs < slow.timingMs`.

## Спробуй сам

1. Зроби звіт по днях (`GROUP BY date_trunc('day', o.created_at)`) і подивись через `EXPLAIN ANALYZE`, чи використовує Postgres індекс `orders (tenant_id, status)`. Якщо ні, додай потрібний і виміряй.
2. Виправ лише третю проблему в `slowReport` (JSON і `includes`), лишивши N+1, і виміряй. Поясни числами, чому це не дало майже нічого.
