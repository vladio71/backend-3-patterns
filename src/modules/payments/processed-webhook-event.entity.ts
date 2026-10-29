// Таблиця ідемпотентності вебхуків: event id як первинний ключ.
// Вставка в тій самій транзакції, що й зміна замовлення: або обидві, або жодна.
import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'processed_webhook_events' })
export class ProcessedWebhookEvent {
  @PrimaryColumn({ name: 'event_id', type: 'text' })
  eventId!: string;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;
}
