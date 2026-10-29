import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'feature_flags' })
export class FeatureFlag {
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
