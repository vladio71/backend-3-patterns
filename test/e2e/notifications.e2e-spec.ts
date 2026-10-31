// Модуль notifications: order.paid -> лист у sent_emails; провайдер падає 3 рази -> job у notifications-dlq.
import { DataSource } from 'typeorm';
import { EmailWorker } from '../../src/modules/notifications/email.worker';
import { FakeEmailProvider } from '../../src/modules/notifications/fake-email.provider';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { SentEmail } from '../../src/modules/notifications/sent-email.entity';
import { EventsConsumer } from '../../src/modules/outbox/events.consumer';
import { OutboxRelay } from '../../src/modules/outbox/outbox.relay';
import { QUEUES, Queues } from '../../src/modules/queues/queues.module';
import { auth, createApp, createProduct, registerTenant, Session, TestApp, waitFor } from './helpers';

describe('notifications', () => {
  let t: TestApp;
  let admin: Session;
  let ds: DataSource;
  let queues: Queues;
  let emailWorker: EmailWorker;
  let consumer: EventsConsumer;

  beforeAll(async () => {
    t = await createApp();
    admin = await registerTenant(t, 'notif');
    ds = t.app.get(DataSource);
    queues = t.app.get<Queues>(QUEUES);
    await queues.notifications.obliterate({ force: true });
    await queues.notificationsDlq.obliterate({ force: true });
    await t.app.get(FakeEmailProvider).setFailing(false);
    emailWorker = t.app.get(EmailWorker);
    consumer = t.app.get(EventsConsumer);
    emailWorker.start();
    consumer.start();
    t.app.get(OutboxRelay).start();
  });

  afterAll(async () => {
    await t.app.get(FakeEmailProvider).setFailing(false);
    t.app.get(OutboxRelay).stop();
    await consumer.stop();
    await emailWorker.stop();
    await t.app.close();
  });

  it('успішний checkout -> order.paid -> лист у sent_emails', async () => {
    const product = await createProduct(t, admin, { stock: 10 });
    const res = await t.http().post('/checkout').set(auth(admin)).send({ items: [{ productId: product.id, qty: 1 }], address: 'Миколаїв' }).expect(201);

    await waitFor(async () => (await ds.getRepository(SentEmail).count({ where: { to: admin.email } })) >= 1, 15_000);
    const emails = await ds.getRepository(SentEmail).find({ where: { to: admin.email } });
    expect(emails[0].subject).toContain(res.body.orderId);

    const viaApi = await t.http().get('/notifications/emails').set(auth(admin)).query({ to: admin.email }).expect(200);
    expect(viaApi.body).toHaveLength(1);
  });

  it('провайдер падає: 3 спроби з backoff, потім job у notifications-dlq, листа немає', async () => {
    const email = t.app.get(FakeEmailProvider);
    await email.setFailing(true);
    const jobId = `email-test-dlq-${Date.now()}`;
    await t.app.get(NotificationsService).enqueue({ to: 'dlq@example.com', subject: 'Тест DLQ', body: 'x', orderId: null, eventId: null, tenantId: admin.tenantId }, jobId);

    await waitFor(async () => (await queues.notificationsDlq.getJob(`dlq-${jobId}`)) !== undefined, 15_000);
    const dlqJob = await queues.notificationsDlq.getJob(`dlq-${jobId}`);
    expect(dlqJob!.data).toMatchObject({ to: 'dlq@example.com', attempts: 3, failedReason: expect.stringContaining('SMTP') });

    const original = await queues.notifications.getJob(jobId);
    expect(original!.attemptsMade).toBe(3);
    expect(await ds.getRepository(SentEmail).count({ where: { to: 'dlq@example.com' } })).toBe(0);

    const dlq = await t.http().get('/notifications/dlq').set(auth(admin)).expect(200);
    expect(dlq.body.map((j: { id: string }) => j.id)).toContain(`dlq-${jobId}`);

    // DLQ показує лише листи свого tenant: адмін іншого tenant цей job не бачить.
    const other = await registerTenant(t, 'notif-other');
    const otherDlq = await t.http().get('/notifications/dlq').set(auth(other)).expect(200);
    expect(otherDlq.body.map((j: { id: string }) => j.id)).not.toContain(`dlq-${jobId}`);
    await email.setFailing(false);
  });

  it('провайдер падає лише раз: retry з backoff доставляє лист без DLQ', async () => {
    const email = t.app.get(FakeEmailProvider);
    await email.setFailing(true);
    const jobId = `email-test-retry-${Date.now()}`;
    await t.app.get(NotificationsService).enqueue({ to: 'retry@example.com', subject: 'Тест retry', body: 'x', orderId: null, eventId: null, tenantId: admin.tenantId }, jobId);
    await waitFor(async () => ((await queues.notifications.getJob(jobId))?.attemptsMade ?? 0) >= 1, 10_000);
    await email.setFailing(false);

    // За jobId, а не за адресою: база між прогонами не чиститься, і лист від попереднього прогону не має зараховуватись.
    await waitFor(async () => (await ds.getRepository(SentEmail).count({ where: { jobId } })) === 1, 15_000);
    expect(await queues.notificationsDlq.getJob(`dlq-${jobId}`)).toBeUndefined();
  });
});
