// Стан саґи в базі: який крок виконується, що вже скомпенсовано. Після падіння процесу worker продовжує з цього рядка.
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type SagaStep = 'reserve_stock' | 'charge_payment' | 'create_shipment' | 'done';
export type SagaStatus = 'running' | 'completed' | 'compensating' | 'compensated';

export type SagaItem = { productId: string; qty: number; priceCents: number };

export type SagaPayload = {
  items: SagaItem[];
  address: string;
  amountCents: number;
  failPayment: boolean;
  paymentRef: string | null;
  shipmentId: string | null;
};

@Entity({ name: 'checkout_sagas' })
@Index('checkout_sagas_status_updated_idx', ['status', 'updatedAt'])
export class CheckoutSaga {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'order_id', type: 'uuid', unique: true })
  orderId!: string;

  @Column({ type: 'text', default: 'reserve_stock' })
  step!: SagaStep;

  @Column({ type: 'text', default: 'running' })
  status!: SagaStatus;

  /** Які компенсації вже виконані, напр. ["refund", "release_stock"]. */
  @Column({ name: 'compensations_done', type: 'jsonb', default: () => "'[]'" })
  compensationsDone!: string[];

  @Column({ type: 'jsonb' })
  payload!: SagaPayload;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
