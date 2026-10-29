// Seed: 2 tenants, у кожному admin + 2 users, 20 товарів, кілька замовлень, прапорці.
// Запуск: npm run seed (ідемпотентний: повторний запуск нічого не дублює).
import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../src/data-source';
import { Tenant } from '../src/modules/auth/tenant.entity';
import { User } from '../src/modules/auth/user.entity';
import { FeatureFlag } from '../src/modules/feature-flags/feature-flag.entity';
import { OrderItem } from '../src/modules/orders/order-item.entity';
import { Order } from '../src/modules/orders/order.entity';
import { Product } from '../src/modules/products/product.entity';

export const SEED_PASSWORD = 'password123';

const TENANTS = [
  { slug: 'acme', name: 'ACME Shop' },
  { slug: 'globex', name: 'Globex Store' },
];

const PRODUCT_NAMES = [
  'Клавіатура', 'Миша', 'Монітор 24"', 'Монітор 27"', 'Навушники', 'Вебкамера', 'Мікрофон', 'Кабель USB-C',
  'Док-станція', 'SSD 1 ТБ', 'Оперативна пам\'ять 16 ГБ', 'Ноутбук', 'Планшет', 'Смартфон', 'Зарядний пристрій',
  'Колонка', 'Рюкзак', 'Підставка для ноутбука', 'Килимок', 'Лампа',
];

async function main(): Promise<void> {
  const ds = new DataSource({ ...dataSourceOptions(), logging: false });
  await ds.initialize();
  await ds.runMigrations();
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 8);

  for (const tenantData of TENANTS) {
    let tenant = await ds.getRepository(Tenant).findOne({ where: { slug: tenantData.slug } });
    if (!tenant) tenant = await ds.getRepository(Tenant).save(ds.getRepository(Tenant).create(tenantData));

    const users: User[] = [];
    for (const [email, role] of [[`admin@${tenant.slug}.test`, 'admin'], [`user1@${tenant.slug}.test`, 'user'], [`user2@${tenant.slug}.test`, 'user']] as const) {
      let user = await ds.getRepository(User).findOne({ where: { tenantId: tenant.id, email } });
      if (!user) user = await ds.getRepository(User).save(ds.getRepository(User).create({ tenantId: tenant.id, email, passwordHash, role }));
      users.push(user);
    }

    const products: Product[] = [];
    for (let i = 0; i < PRODUCT_NAMES.length; i++) {
      const sku = `${tenant.slug.toUpperCase()}-${String(i + 1).padStart(3, '0')}`;
      let product = await ds.getRepository(Product).findOne({ where: { tenantId: tenant.id, sku } });
      if (!product) {
        product = await ds.getRepository(Product).save(ds.getRepository(Product).create({
          tenantId: tenant.id, sku, name: PRODUCT_NAMES[i], priceCents: 19900 + i * 5000, currency: 'UAH', stock: 50 + i,
        }));
      }
      products.push(product);
    }

    const existingOrders = await ds.getRepository(Order).count({ where: { tenantId: tenant.id } });
    if (existingOrders === 0) {
      for (let i = 0; i < 5; i++) {
        const picks = products.slice(i, i + 2);
        const items = picks.map((p) => ds.getRepository(OrderItem).create({ productId: p.id, qty: 1 + i, priceCents: p.priceCents }));
        const totalCents = items.reduce((sum, item) => sum + item.qty * item.priceCents, 0);
        await ds.getRepository(Order).save(ds.getRepository(Order).create({
          tenantId: tenant.id, userId: users[1 + (i % 2)].id, status: i % 2 === 0 ? 'paid' : 'pending', totalCents, currency: 'UAH', items,
        }));
      }
    }
    console.log(`tenant ${tenant.slug}: ${users.length} users, ${products.length} products`);
  }

  const flags = ds.getRepository(FeatureFlag);
  await flags.save(flags.create({ key: 'products-v2-default', enabled: true, percentage: 30, allowlist: [] }));
  await flags.save(flags.create({ key: 'new-checkout-ui', enabled: false, percentage: 0, allowlist: [] }));
  console.log('flags: products-v2-default (30 %), new-checkout-ui (off)');
  console.log(`Логін: tenantSlug=acme, email=admin@acme.test, password=${SEED_PASSWORD}`);
  await ds.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
