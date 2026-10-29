// Явний запис в audit для змін через QueryBuilder (підписник їх не бачить) і читання журналу.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { RequestContext } from '../../common/request-context';
import { AuditAction, AuditLog } from './audit-log.entity';

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>, private readonly ctx: RequestContext) {}

  async record(manager: EntityManager, entity: string, entityId: string, action: AuditAction, before: Record<string, unknown> | null, after: Record<string, unknown> | null): Promise<void> {
    await manager.save(AuditLog, manager.create(AuditLog, {
      entity, entityId, action, before, after, userId: this.ctx.userId(), requestId: this.ctx.requestId(),
    }));
  }

  list(entity: string, entityId: string): Promise<AuditLog[]> {
    return this.logs.find({ where: { entity, entityId }, order: { at: 'ASC' } });
  }
}
