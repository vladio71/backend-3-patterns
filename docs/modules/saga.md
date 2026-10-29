# Саґа: оформлення з трьох кроків і компенсації

Код: `src/modules/checkout/` (сервіс, resumer, таблиця `checkout_sagas`).

## Проблема

`POST /checkout` робить три речі: резервує товар на складі, списує гроші, створює відправлення. Кожна з них окрема: склад і відправлення у нашій базі, платіж у зовнішнього провайдера. Якщо гроші списати не вдалося, резерв треба повернути. Якщо відправлення не створилось після успішного списання, гроші треба повернути.

## Наївне рішення і де воно ламається

```ts
await reserveStock(items);
await payments.charge(amount);     // кинув помилку
await createShipment(order);
```

Сценарій: платіж відхилено (`X-Fail-Payment: 1` або сума на .99). Функція кидає виняток, клієнт бачить 402. Але `reserveStock` уже виконався: `products.stock` зменшено, а замовлення нікому не належить. Через годину товару "немає", хоча він на полиці.

Обгорнути все в одну транзакцію Postgres не вийде: `payments.charge` це HTTP-запит до іншої компанії, його не відкотити командою `ROLLBACK`.

Другий сценарій: процес API упав після `charge`, але до `createShipment`. Гроші списані, відправлення немає, ніхто не знає, що саме треба доробити.

## Правильне рішення

Саґа: послідовність кроків, де кожен крок має компенсацію, і стан прогресу живе в базі (`checkout_sagas`: `step`, `status`, `compensations_done`, `payload`).

```
крок            компенсація
reserve_stock   release_stock
charge_payment  refund
create_shipment (немає: це останній крок)
```

`CheckoutService.run(saga)` виконує кроки з `saga.step`, після кожного зберігає наступний крок у базу. При помилці:

```
status = compensating
  є paymentRef і немає 'refund' у compensations_done   -> refund, записати 'refund'
  step пішов далі за reserve_stock і немає 'release_stock' -> повернути stock, записати 'release_stock'
  order.status = cancelled, подія outbox order.cancelled
status = compensated
```

Кожна компенсація записується в `compensations_done` одразу після виконання. Тому `compensate` можна викликати двічі, і refund не повториться.

Резерв складу робиться під блокуванням рядка (`SELECT ... FOR UPDATE` у `reserveStock`): два паралельних checkout на останню одиницю товару стають у чергу, другий бачить `stock = 0` і падає на першому кроці.

Падіння процесу: саґа лишається зі `status = running`. `SagaResumer` (worker) раз на 5 секунд бере саґи, які не оновлювались довше за `SAGA_RESUME_AFTER_MS`, і викликає той самий `run(saga)`. Кроки, що вже виконані, пропускаються по `payload` (`paymentRef` є, значить списання було).

Заголовок `X-Crash-After: reserve_stock` імітує падіння після кроку: саґа лишається `running`, HTTP отримує 500 `SIMULATED_CRASH`.

## Тест, який це доводить

`test/e2e/saga.e2e-spec.ts`:

- "платіж відхилено": 402 `CHECKOUT_FAILED`, `step = charge_payment`; `products.stock` знову 5; `checkout_sagas.status = compensated`, `compensations_done = ['release_stock']`; замовлення `cancelled`; у `shipments` нічого.
- "недостатньо товару": падіння на `reserve_stock`, компенсацій немає, платежу немає.
- "падіння процесу після reserve_stock": після 500 саґа `running` зі `step = charge_payment`; `SagaResumer.tick()` доводить її до `completed`, stock списано один раз.

## Спробуй сам

1. Додай четвертий крок `send_receipt` (подія в outbox) з компенсацією `cancel_receipt`. Перевір, що при падінні на ньому refund і release_stock виконуються в правильному порядку.
2. Зроби так, щоб `SagaResumer` не підхоплював саґу, яку в цей момент іще виконує API-процес (підказка: `FOR UPDATE SKIP LOCKED` на рядку саґи).
