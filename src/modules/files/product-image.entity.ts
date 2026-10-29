import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'product_images' })
@Index('product_images_tenant_product_idx', ['tenantId', 'productId'])
export class ProductImage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  /** Ключ об'єкта в бакеті, напр. tenants/<tenant>/products/<product>/<uuid>.jpg */
  @Column({ type: 'text', unique: true })
  key!: string;

  @Column({ name: 'content_type', type: 'text' })
  contentType!: string;

  @Column({ type: 'integer' })
  size!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
