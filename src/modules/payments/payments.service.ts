// Обробка вебхука "оплата пройшла". Ідемпотентність на первинному ключі processed_webhook_events:
// вставка id події + зміна замовлення + рядок платежу + подія outbox в ОДНІЙ транзакції.
//
// Сума з вебхука мусить збігатися з сумою замовлення (order.totalCents). Підпис HMAC доводить лише, що подію надіслав
// провайдер, а не що в ній правильні гроші: помилка на боці провайдера або підміна замовлення на дешевше не повинні
// перетворити замовлення на 5000 на "оплачене" за 50. Розбіжність це 422, і подію НЕ позначаємо обробленою:
// транзакція відкочується разом із вставкою в processed_webhook_events (це чесніше за "прийняти й проігнорувати":
// провайдер бачить помилку і не вважає, що ми все обробили). Ціна такого вибору: провайдер повторюватиме цю подію,
// доки хтось не розбереться, і кожна спроба лишає рядок у логу з eventId, очікуваною та отриманою сумою.
// Зберегти подію з позначкою rejected вимагало б нової колонки в processed_webhook_events.
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isUniqueViolationOn, notFound, unprocessable } from '../../common/errors';
import { Order } from '../orders/order.entity';
import { OutboxService } from '../outbox/outbox.service';
import { Payment } from './payment.entity';
import { PaymentWebhookDto } from './payments.dto';
import { ProcessedWebhookEvent } from './processed-webhook-event.entity';

// Ім'я первинного ключа, яке Postgres дав таблиці при CREATE TABLE ... PRIMARY KEY.
const PROCESSED_EVENTS_PKEY = 'processed_webhook_events_pkey';

export type WebhookResult = { duplicate: boolean; orderId: string; status: string };

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly dataSource: DataSource, private readonly outbox: OutboxService) {}

  async handlePaymentSucceeded(dto: PaymentWebhookDto): Promise<WebhookResult> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        // 1. Спочатку "займаємо" id події. Друга доставка впаде тут на 23505 (одразу або після коміту першої).
        await manager.insert(ProcessedWebhookEvent, { eventId: dto.eventId });

        // 2. Замовлення під блокуванням рядка, щоб паралельні зміни (саґа) чекали.
        const order = await manager.findOne(Order, { where: { id: dto.orderId }, lock: { mode: 'pessimistic_write' } });
        if (!order) throw notFound('Замовлення');

        if (dto.amountCents !== order.totalCents) {
          this.logger.warn(`Вебхук ${dto.eventId} відхилено: для замовлення ${order.id} очікували ${order.totalCents}, прийшло ${dto.amountCents}`);
          throw unprocessable('AMOUNT_MISMATCH', 'Сума в події не збігається із сумою замовлення', {
            orderId: order.id, expectedCents: order.totalCents, receivedCents: dto.amountCents,
          });
        }

        if (order.status === 'pending') {
          order.status = 'paid';
          await manager.save(Order, order); // через save, щоб спрацював audit-підписник

          await manager.save(Payment, manager.create(Payment, {
            tenantId: order.tenantId, orderId: order.id, providerRef: dto.paymentRef ?? dto.eventId, amountCents: dto.amountCents, status: 'charged',
          }));

          await this.outbox.append(manager, 'order.paid', order.tenantId, { orderId: order.id, userId: order.userId, amountCents: dto.amountCents });
        }
        return { duplicate: false, orderId: order.id, status: order.status };
      });
    } catch (error) {
      // Лише порушення первинного ключа processed_webhook_events означає "цю подію вже оброблено".
      // Інше 23505 (напр. provider_ref у payments) це справжня помилка, її не можна видавати за дублікат.
      if (isUniqueViolationOn(error, PROCESSED_EVENTS_PKEY)) {
        this.logger.log(`Повторна доставка події ${dto.eventId}`);
        return { duplicate: true, orderId: dto.orderId, status: 'unchanged' };
      }
      throw error;
    }
  }
}
