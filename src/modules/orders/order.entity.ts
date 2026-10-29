import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { OrderItem } from './order-item.entity';

export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'shipped';

@Entity({ name: 'orders' })
@Index('orders_tenant_status_idx', ['tenantId', 'status'])
@Index('orders_tenant_user_idx', ['tenantId', 'userId'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'text', default: 'pending' })
  status!: OrderStatus;

  @Column({ name: 'total_cents', type: 'integer' })
  totalCents!: number;

  @Column({ type: 'text', default: 'UAH' })
  currency!: string;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: ['insert'] })
  items!: OrderItem[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
