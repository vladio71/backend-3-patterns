import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Прапорець належить tenant: ключ це пара (tenant_id, key), admin одного tenant не бачить і не змінює прапорці іншого. */
@Entity({ name: 'feature_flags' })
export class FeatureFlag {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ type: 'text' })
  key!: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  /** 0..100: частка користувачів, для яких прапорець увімкнено. */
  @Column({ type: 'integer', default: 0 })
  percentage!: number;

  /** Користувачі, для яких прапорець увімкнено завжди (напр. тестувальники). */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  allowlist!: string[];

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
