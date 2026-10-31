// Модуль outbox: подія записана в одній транзакції з замовленням; relay, що впав перед publish, не губить подію;
// споживач застосовує ефект один раз навіть при повторній доставці.
import { Job } from 'bullmq';
import { DataSource, IsNull } from 'typeorm';
import { ConsumedEvent } from '../../src/modules/outbox/consumed-event.entity';
import { EventsConsumer } from '../../src/modules/outbox/events.consumer';
import { OutboxEvent } from '../../src/modules/outbox/outbox-event.entity';
import { OutboxJobData, OutboxRelay } from '../../src/modules/outbox/outbox.relay';
import { QUEUES, Queues } from '../../src/modules/queues/queues.module';
import { auth, createApp, createProduct, registerTenant, Session, TestApp } from './helpers';

describe('outbox', () => {
  let t: TestApp;
  let admin: Session;
  let productId: string;
  let ds: DataSource;
  let relay: OutboxRelay;
  let consumer: EventsConsumer;
  let queues: Queues;

  beforeAll(async () => {
    t = await createApp();
    admin = await registerTenant(t, 'outbox');
    productId = (await createProduct(t, admin)).id;
    ds = t.app.get(DataSource);
    relay = t.app.get(OutboxRelay);
    consumer = t.app.get(EventsConsumer);
    queues = t.app.get<Queues>(QUEUES);
    await queues.events.drain(true);
  });

  afterAll(async () => {
    await t.app.close();
  });

  async function createOrder(): Promise<string> {
    const res = await t.http().post('/orders').set(auth(admin)).send({ items: [{ productId, qty: 1 }] }).expect(201);
    return res.body.id;
  }

  it('замовлення і подія order.created записані разом', async () => {
    const orderId = await createOrder();
    const event = await ds.getRepository(OutboxEvent).createQueryBuilder('e')
      .where(`e.type = 'order.created' AND e.payload->>'orderId' = :orderId`, { orderId }).getOne();
    expect(event).not.toBeNull();
    expect(event!.publishedAt).toBeNull();
  });

  it('relay упав між INSERT і publish: подія лишилась і пішла на наступному тику', async () => {
    const orderId = await createOrder();
    const find = () => ds.getRepository(OutboxEvent).createQueryBuilder('e')
      .where(`e.type = 'order.created' AND e.payload->>'orderId' = :orderId`, { orderId }).getOneOrFail();

    // Подія, на якій relay упаде: найстаріша неопублікована (у черзі можуть бути події з попередніх тестів).
    const oldest = await ds.getRepository(OutboxEvent).findOneOrFail({ where: { publishedAt: IsNull() }, order: { createdAt: 'ASC' } });
    const attemptsBefore = oldest.attempts;

    relay.failNextPublish = true;
    await expect(relay.tick()).rejects.toThrow('Імітація падіння relay');
    const afterCrash = await find();
    expect(afterCrash.publishedAt).toBeNull(); // транзакція відкотилась, рядок не втрачено
    // attempts рахує невдалі публікації і переживає відкат (окрема коротка транзакція)
    expect((await ds.getRepository(OutboxEvent).findOneByOrFail({ id: oldest.id })).attempts).toBe(attemptsBefore + 1);

    const published = await relay.tick();
    expect(published).toBeGreaterThanOrEqual(1);
    const afterRetry = await find();
    expect(afterRetry.publishedAt).not.toBeNull();
    expect((await ds.getRepository(OutboxEvent).findOneByOrFail({ id: oldest.id })).attempts).toBe(attemptsBefore + 1); // успішна публікація лічильник не чіпає

    const job = await queues.events.getJob(afterRetry.id);
    expect(job).toBeDefined();
    expect(job!.data.eventId).toBe(afterRetry.id);
  });

  it('повторна доставка тієї самої події не повторює ефект', async () => {
    const orderId = await createOrder();
    await relay.tick();
    const event = await ds.getRepository(OutboxEvent).createQueryBuilder('e')
      .where(`e.type = 'order.created' AND e.payload->>'orderId' = :orderId`, { orderId }).getOneOrFail();

    const job = { data: { eventId: event.id, type: event.type, tenantId: event.tenantId, payload: event.payload } } as Job<OutboxJobData>;
    expect(await consumer.handle(job)).toBe(true);
    expect(await consumer.handle(job)).toBe(false); // друга доставка: 23505 на consumed_events, ефекту немає
    expect(await ds.getRepository(ConsumedEvent).count({ where: { eventId: event.id } })).toBe(1);
  });

  it('повний шлях: relay publish -> BullMQ worker -> consumed_events', async () => {
    consumer.start();
    const orderId = await createOrder();
    await relay.tick();
    const event = await ds.getRepository(OutboxEvent).createQueryBuilder('e')
      .where(`e.type = 'order.created' AND e.payload->>'orderId' = :orderId`, { orderId }).getOneOrFail();
    const deadline = Date.now() + 10_000;
    let consumed = 0;
    while (Date.now() < deadline && consumed === 0) {
      consumed = await ds.getRepository(ConsumedEvent).count({ where: { eventId: event.id } });
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(consumed).toBe(1);
    await consumer.stop();
  });
});
