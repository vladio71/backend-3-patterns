// Модуль profiling. slowReport: N+1 запитів, фільтр по колонці без індексу, JSON склеюється рядком у циклі.
// fastReport: один SQL з GROUP BY, Map замість find у циклі, звичайний об'єкт у відповідь.
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RequestContext } from '../../common/request-context';
import { OrderItem } from '../orders/order-item.entity';
import { Order } from '../orders/order.entity';
import { Product } from '../products/product.entity';

export type ReportRow = { productId: string; sku: string; name: string; soldQty: number; revenueCents: number; orders: number };
export type Report = { timingMs: number; queries: number; rows: ReportRow[] };

@Injectable()
export class ReportsService {
  constructor(private readonly dataSource: DataSource, private readonly ctx: RequestContext) {}

  async slowReport(): Promise<Report> {
    const tenantId = this.ctx.tenantIdOrFail();
    const started = performance.now();
    let queries = 0;

    const products = await this.dataSource.getRepository(Product).find({ where: { tenantId }, order: { createdAt: 'ASC' } }); // той самий порядок, що в fast-report
    queries++;

    let json = '['; // (3) JSON збираємо рядком
    let first = true;
    for (const product of products) {
      // (1) N+1: окремий запит на кожен товар; (2) product_id без індексу до міграції AddOrderItemsProductIdx
      const items = await this.dataSource.getRepository(OrderItem).find({ where: { productId: product.id } });
      queries++;
      let soldQty = 0;
      let revenueCents = 0;
      const orderIds: string[] = [];
      for (const item of items) {
        // ще один запит на кожну позицію, щоб перевірити статус замовлення
        const order = await this.dataSource.getRepository(Order).findOne({ where: { id: item.orderId } });
        queries++;
        if (!order || order.status === 'cancelled') continue;
        soldQty += item.qty;
        revenueCents += item.qty * item.priceCents;
        if (!orderIds.includes(order.id)) orderIds.push(order.id); // O(n^2) пошук у масиві
      }
      const row: ReportRow = { productId: product.id, sku: product.sku, name: product.name, soldQty, revenueCents, orders: orderIds.length };
      json += (first ? '' : ',') + JSON.stringify(row);
      first = false;
    }
    json += ']';

    return { timingMs: round(performance.now() - started), queries, rows: JSON.parse(json) as ReportRow[] };
  }

  async fastReport(): Promise<Report> {
    const tenantId = this.ctx.tenantIdOrFail();
    const started = performance.now();

    const rows: Array<{ product_id: string; sku: string; name: string; sold_qty: string; revenue_cents: string; orders: string }> = await this.dataSource.query(
      `SELECT p.id AS product_id, p.sku, p.name,
              COALESCE(SUM(oi.qty), 0) AS sold_qty,
              COALESCE(SUM(oi.qty * oi.price_cents), 0) AS revenue_cents,
              COUNT(DISTINCT o.id) AS orders
         FROM products p
         LEFT JOIN (order_items oi JOIN orders o ON o.id = oi.order_id AND o.status <> 'cancelled')
           ON oi.product_id = p.id
        WHERE p.tenant_id = $1 AND p.deleted_at IS NULL
        GROUP BY p.id
        ORDER BY p.created_at`,
      [tenantId],
    );

    const report = rows.map((r) => ({
      productId: r.product_id, sku: r.sku, name: r.name, soldQty: Number(r.sold_qty), revenueCents: Number(r.revenue_cents), orders: Number(r.orders),
    }));
    return { timingMs: round(performance.now() - started), queries: 1, rows: report };
  }
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}
