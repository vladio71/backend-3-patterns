// Запис події в outbox. Викликається ТІЛЬКИ з транзакції, яка змінює бізнес-дані: той самий manager.
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OutboxEvent } from './outbox-event.entity';

export type OutboxEventType = 'order.created' | 'order.paid' | 'order.cancelled';

@Injectable()
export class OutboxService {
  append(manager: EntityManager, type: OutboxEventType, tenantId: string, payload: Record<string, unknown>): Promise<OutboxEvent> {
    const event = manager.create(OutboxEvent, { type, tenantId, payload });
    return manager.save(OutboxEvent, event);
  }
}
