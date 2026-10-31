import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AppConfig } from '../../common/config';
import { Queues } from '../queues/queues.module';
import { EmailWorker } from './email.worker';
import { FakeEmailProvider } from './fake-email.provider';
import { EmailJobData } from './notifications.service';

describe('EmailWorker.handle: DLQ на останній спробі', () => {
  const data: EmailJobData = { to: 'a@example.com', subject: 's', body: 'b', orderId: null, eventId: null, tenantId: 'tenant-1' };
  const dlqAdd = jest.fn();
  const send = jest.fn();
  const queues = { notificationsDlq: { add: dlqAdd } } as unknown as Queues;
  const worker = new EmailWorker({ send } as unknown as FakeEmailProvider, queues, {} as AppConfig);

  /** BullMQ: у обробнику attemptsMade це кількість уже ЗАВЕРШЕНИХ невдалих спроб (на першій спробі 0). */
  function job(attemptsMade: number): Job<EmailJobData> {
    return { id: 'j1', data, attemptsMade, opts: { attempts: 3 } } as unknown as Job<EmailJobData>;
  }

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => jest.restoreAllMocks());

  beforeEach(() => {
    dlqAdd.mockReset();
    send.mockReset().mockRejectedValue(new Error('SMTP недоступний'));
  });

  it('перша і друга невдалі спроби: помилка летить у BullMQ, у DLQ нічого', async () => {
    await expect(worker.handle(job(0))).rejects.toThrow('SMTP недоступний');
    await expect(worker.handle(job(1))).rejects.toThrow('SMTP недоступний');
    expect(dlqAdd).not.toHaveBeenCalled();
  });

  it('третя (остання) спроба: копія в DLQ робиться до того, як помилка піде далі', async () => {
    await expect(worker.handle(job(2))).rejects.toThrow('SMTP недоступний');
    expect(dlqAdd).toHaveBeenCalledWith(
      'email',
      { ...data, failedReason: 'SMTP недоступний', attempts: 3 },
      { jobId: 'dlq-j1' },
    );
  });

  it('успішна відправка нічого не пише в DLQ', async () => {
    send.mockReset().mockResolvedValue({});
    await expect(worker.handle(job(2))).resolves.toBeUndefined();
    expect(dlqAdd).not.toHaveBeenCalled();
  });
});
