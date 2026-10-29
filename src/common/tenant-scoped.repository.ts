// Репозиторій, який сам додає WHERE tenant_id = <поточний tenant> до кожного запиту.
// Сервіси не можуть забути фільтр, бо не бачать "сирого" репозиторію.
import { EntityManager, FindOptionsOrder, FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm';
import { RequestContext } from './request-context';

export type TenantOwned = ObjectLiteral & { id: string; tenantId: string };

export class TenantScopedRepository<T extends TenantOwned> {
  constructor(private readonly repo: Repository<T>, private readonly ctx: RequestContext) {}

  private tenantId(): string {
    return this.ctx.tenantIdOrFail();
  }

  /** Умова для будь-якого запиту: завжди починаємо з tenant_id. */
  scope(where: FindOptionsWhere<T> = {}): FindOptionsWhere<T> {
    return { ...where, tenantId: this.tenantId() } as FindOptionsWhere<T>;
  }

  find(where: FindOptionsWhere<T> = {}, order?: FindOptionsOrder<T>, relations?: string[], withDeleted = false): Promise<T[]> {
    return this.repo.find({ where: this.scope(where), order, relations, withDeleted });
  }

  /** Чужий id повертає null, як і неіснуючий: клієнт не має дізнатися, що запис існує в іншому tenant. */
  findOneById(id: string, relations?: string[], withDeleted = false): Promise<T | null> {
    const where = { id } as unknown as FindOptionsWhere<T>;
    return this.repo.findOne({ where: this.scope(where), relations, withDeleted });
  }

  findOne(where: FindOptionsWhere<T>, relations?: string[]): Promise<T | null> {
    return this.repo.findOne({ where: this.scope(where), relations });
  }

  create(data: Partial<T>): T {
    return this.repo.create({ ...data, tenantId: this.tenantId() } as T);
  }

  save(entity: T, manager?: EntityManager): Promise<T> {
    if (entity.tenantId !== this.tenantId()) throw new Error('TenantScopedRepository: спроба зберегти запис іншого tenant');
    return manager ? manager.save(entity) : this.repo.save(entity);
  }

  softRemove(entity: T): Promise<T> {
    return this.repo.softRemove(entity);
  }

  recover(entity: T): Promise<T> {
    return this.repo.recover(entity);
  }

  raw(): Repository<T> {
    return this.repo;
  }
}
