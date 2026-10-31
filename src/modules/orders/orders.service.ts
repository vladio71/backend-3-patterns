// Замовлення. create: замовлення + позиції + подія outbox order.created в одній транзакції.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere, In, Repository } from 'typeorm';
import { badRequest, notFound } from '../../common/errors';
import { RequestContext } from '../../common/request-context';
import { TenantScopedRepository } from '../../common/tenant-scoped.repository';
import { OutboxService } from '../outbox/outbox.service';
import { Product } from '../products/product.entity';
import { OrderItem } from './order-item.entity';
import { Order } from './order.entity';
import { OrderItemDto } from './orders.dto';

// UUID, якого немає в базі: запит без користувача в контексті не має повернути чужі замовлення.
const NO_USER = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class OrdersService {
  private readonly orders: TenantScopedRepository<Order>;

  constructor(
    @InjectRepository(Order) repo: Repository<Order>,
    private readonly ctx: RequestContext,
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
  ) {
    this.orders = new TenantScopedRepository(repo, ctx);
  }

  /** Admin бачить усі замовлення tenant, звичайний користувач лише свої. */
  list(): Promise<Order[]> {
    const where: FindOptionsWhere<Order> = {};
    if (this.ctx.role() !== 'admin') where.userId = this.ctx.userId() ?? NO_USER;
    return this.orders.find(where, { createdAt: 'DESC' }, ['items']);
  }

  /** Те саме правило, що в list(): admin бачить будь-яке замовлення tenant, звичайний користувач лише своє.
   *  Чуже замовлення віддаємо як 404, а не 403: інакше по коду відповіді можна перебирати id і дізнаватись, які існують. */
  async getOrFail(id: string): Promise<Order> {
    const order = await this.orders.findOneById(id, ['items']);
    if (!order) throw notFound('Замовлення');
    if (this.ctx.role() !== 'admin' && order.userId !== this.ctx.userId()) throw notFound('Замовлення');
    return order;
  }

  create(items: OrderItemDto[]): Promise<Order> {
    return this.dataSource.transaction((manager) => this.createIn(manager, items));
  }

  /**
   * Те саме, що create, але в чужій транзакції: checkout кладе сюди ще й рядок саґи,
   * щоб замовлення без саґи (і саґа без замовлення) не могли існувати.
   */
  async createIn(manager: EntityManager, items: OrderItemDto[]): Promise<Order> {
    const tenantId = this.ctx.tenantIdOrFail();
    const userId = this.ctx.userId();
    if (!userId) throw badRequest('NO_USER', 'Немає користувача в контексті');

    const products = await manager.find(Product, { where: { tenantId, id: In(items.map((i) => i.productId)) } });
    const byId = new Map(products.map((p) => [p.id, p]));
    let totalCents = 0;
    const orderItems: OrderItem[] = [];
    for (const item of items) {
      const product = byId.get(item.productId);
      if (!product) throw notFound(`Товар ${item.productId}`);
      totalCents += product.priceCents * item.qty;
      orderItems.push(manager.create(OrderItem, { productId: product.id, qty: item.qty, priceCents: product.priceCents }));
    }

    const order = manager.create(Order, { tenantId, userId, status: 'pending', totalCents, currency: 'UAH', items: orderItems });
    const saved = await manager.save(Order, order);

    // Та сама транзакція: якщо подія не записалась, замовлення теж не створено.
    await this.outbox.append(manager, 'order.created', tenantId, { orderId: saved.id, userId, totalCents });
    return saved;
  }
}
