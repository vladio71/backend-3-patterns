// Товари: усі запити через TenantScopedRepository (tenant_id додається сам),
// PATCH з оптимістичним блокуванням по version, soft delete і restore.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { conflict, isUniqueViolation, notFound } from '../../common/errors';
import { RequestContext } from '../../common/request-context';
import { TenantScopedRepository } from '../../common/tenant-scoped.repository';
import { AuditService } from '../audit/audit.service';
import { Product } from './product.entity';
import { CreateProductDto, UpdateProductDto } from './products.dto';

@Injectable()
export class ProductsService {
  private readonly products: TenantScopedRepository<Product>;

  constructor(
    @InjectRepository(Product) repo: Repository<Product>,
    ctx: RequestContext,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {
    this.products = new TenantScopedRepository(repo, ctx);
  }

  list(): Promise<Product[]> {
    return this.products.find({}, { createdAt: 'ASC' });
  }

  async getOrFail(id: string): Promise<Product> {
    const product = await this.products.findOneById(id);
    if (!product) throw notFound('Товар'); // і для чужого tenant теж 404, а не 403
    return product;
  }

  async create(dto: CreateProductDto): Promise<Product> {
    const product = this.products.create({
      sku: dto.sku, name: dto.name, priceCents: dto.priceCents, currency: dto.currency ?? 'UAH', stock: dto.stock,
    });
    try {
      return await this.products.save(product);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('SKU_TAKEN', 'Товар із таким sku вже існує');
      throw error;
    }
  }

  /**
   * Оптимістичне блокування: UPDATE ... WHERE id = $1 AND version = $expected.
   * 0 оновлених рядків означає, що хтось уже змінив товар після того, як клієнт його прочитав.
   */
  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const before = await this.getOrFail(id);
    const changes: Partial<Product> = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.priceCents !== undefined) changes.priceCents = dto.priceCents;
    if (dto.stock !== undefined) changes.stock = dto.stock;

    return this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(Product) // TypeORM сам додає version = version + 1 і updated_at = now()
        .set(changes)
        .where('id = :id AND tenant_id = :tenantId AND version = :version AND deleted_at IS NULL', {
          id, tenantId: before.tenantId, version: dto.version,
        })
        .execute();

      if (result.affected === 0) {
        const current = await manager.findOne(Product, { where: { id, tenantId: before.tenantId } });
        if (!current) throw notFound('Товар');
        throw conflict('STALE_VERSION', 'Товар змінено іншим користувачем, перечитайте його', { currentVersion: current.version });
      }

      const after = await manager.findOneOrFail(Product, { where: { id, tenantId: before.tenantId } });
      await this.audit.record(manager, 'product', id, 'update', { ...before }, { ...after });
      return after;
    });
  }

  async softDelete(id: string): Promise<Product> {
    const product = await this.getOrFail(id);
    return this.products.softRemove(product);
  }

  async restore(id: string): Promise<Product> {
    const product = await this.products.findOneById(id, undefined, true);
    if (!product) throw notFound('Товар');
    if (!product.deletedAt) return product;
    try {
      return await this.products.recover(product);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('SKU_TAKEN', 'Поки товар був видалений, його sku зайняв інший товар');
      throw error;
    }
  }

  listDeleted(): Promise<Product[]> {
    return this.products.raw().createQueryBuilder('p')
      .withDeleted()
      .where('p.tenant_id = :tenantId AND p.deleted_at IS NOT NULL', { tenantId: this.productsTenant() })
      .orderBy('p.deleted_at', 'DESC')
      .getMany();
  }

  private productsTenant(): string {
    return this.products.scope().tenantId as string;
  }
}
