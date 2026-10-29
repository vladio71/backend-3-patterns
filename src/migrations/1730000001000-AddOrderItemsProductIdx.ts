// Індекс, якого не вистачало звіту в модулі profiling. Без нього SELECT ... WHERE product_id = $1 робить Seq Scan.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderItemsProductIdx1730000001000 implements MigrationInterface {
  name = 'AddOrderItemsProductIdx1730000001000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE INDEX order_items_product_idx ON order_items (product_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS order_items_product_idx`);
  }
}
