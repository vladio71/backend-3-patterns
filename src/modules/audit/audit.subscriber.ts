// Підписник TypeORM: кожен insert/update/soft delete/restore товару або замовлення лишає рядок у audit_log.
// Пише через event.manager, тобто в тій самій транзакції, що й сама зміна.
import { Injectable } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, EventSubscriber, InsertEvent, RecoverEvent, SoftRemoveEvent, UpdateEvent } from 'typeorm';
import { RequestContext } from '../../common/request-context';
import { Order } from '../orders/order.entity';
import { Product } from '../products/product.entity';
import { AuditAction, AuditLog } from './audit-log.entity';

type Audited = Product | Order;

const AUDITED_ENTITIES: Array<new () => Audited> = [Product, Order];

@Injectable()
@EventSubscriber()
export class AuditSubscriber implements EntitySubscriberInterface<Audited> {
  constructor(dataSource: DataSource, private readonly ctx: RequestContext) {
    dataSource.subscribers.push(this);
  }

  private isAudited(target: unknown): boolean {
    return AUDITED_ENTITIES.some((entity) => entity === target);
  }

  async afterInsert(event: InsertEvent<Audited>): Promise<void> {
    if (!this.isAudited(event.metadata.target)) return;
    await this.write(event, 'insert', null, event.entity);
  }

  async afterUpdate(event: UpdateEvent<Audited>): Promise<void> {
    // Для update через QueryBuilder (manager.update, .update().set()) event.entity це лише set-частина без id,
    // а databaseEntity не завантажено. Такі зміни пишуть audit явно через AuditService.record.
    if (!this.isAudited(event.metadata.target) || !event.entity || !(event.entity as Audited).id) return;
    await this.write(event, 'update', event.databaseEntity ?? null, event.entity as Audited);
  }

  async afterSoftRemove(event: SoftRemoveEvent<Audited>): Promise<void> {
    if (!this.isAudited(event.metadata.target) || !event.entity) return;
    await this.write(event, 'soft_delete', event.databaseEntity ?? null, event.entity as Audited);
  }

  async afterRecover(event: RecoverEvent<Audited>): Promise<void> {
    if (!this.isAudited(event.metadata.target) || !event.entity) return;
    await this.write(event, 'restore', event.databaseEntity ?? null, event.entity as Audited);
  }

  private async write(
    event: { manager: InsertEvent<Audited>['manager']; metadata: InsertEvent<Audited>['metadata'] },
    action: AuditAction,
    before: Audited | null,
    after: Audited,
  ): Promise<void> {
    const row = event.manager.create(AuditLog, {
      entity: event.metadata.tableName.replace(/s$/, ''), // products -> product, orders -> order
      entityId: after.id,
      action,
      before: before ? snapshot(before) : null,
      after: snapshot(after),
      userId: this.ctx.userId(),
      requestId: this.ctx.requestId(),
    });
    await event.manager.save(AuditLog, row);
  }
}

/** Без relations і службових полів: у audit достатньо колонок самої сутності. */
function snapshot(entity: Audited): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity)) {
    if (key === 'items') continue;
    copy[key] = value;
  }
  return copy;
}
