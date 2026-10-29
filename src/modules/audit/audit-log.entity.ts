import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type AuditAction = 'insert' | 'update' | 'soft_delete' | 'restore';

@Entity({ name: 'audit_log' })
@Index('audit_log_entity_idx', ['entity', 'entityId', 'at'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

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
