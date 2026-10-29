import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type PaymentStatus = 'charged' | 'refunded';

@Entity({ name: 'payments' })
@Index('payments_tenant_order_idx', ['tenantId', 'orderId'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  /** Id платежу або події у провайдера. Унікальний: другий запис про ту саму подію неможливий. */
  @Column({ name: 'provider_ref', type: 'text', unique: true })
  providerRef!: string;

  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents!: number;

  @Column({ type: 'text', default: 'charged' })
  status!: PaymentStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
