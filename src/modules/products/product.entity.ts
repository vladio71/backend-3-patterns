// Товар: stock (саґа), version (оптимістичне блокування), deletedAt (soft delete), tenantId (мультитенантність).
import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn, VersionColumn } from 'typeorm';

@Entity({ name: 'products' })
@Index('products_tenant_created_idx', ['tenantId', 'createdAt'])
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text' })
  sku!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'price_cents', type: 'integer' })
  priceCents!: number;

  @Column({ type: 'text', default: 'UAH' })
  currency!: string;

  @Column({ type: 'integer', default: 0 })
  stock!: number;

  /** TypeORM збільшує на 1 при кожному save і перевіряє, що в базі досі стара версія. */
  @VersionColumn()
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /** Soft delete: рядок лишається, TypeORM сам додає WHERE deleted_at IS NULL. */
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
