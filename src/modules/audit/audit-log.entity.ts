import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type AuditAction = 'insert' | 'update' | 'soft_delete' | 'restore';

@Entity({ name: 'audit_log' })
// tenant_id першим: кожне читання журналу відбувається в межах tenant
@Index('audit_log_tenant_entity_idx', ['tenantId', 'entity', 'entityId', 'at'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text' })
  entity!: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @Column({ type: 'text' })
  action!: AuditAction;

  @Column({ type: 'jsonb', nullable: true })
  before!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after!: Record<string, unknown> | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'request_id', type: 'text', nullable: true })
  requestId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  at!: Date;
}
