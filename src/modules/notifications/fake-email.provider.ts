// Фейковий email-провайдер: замість SMTP пише лист у таблицю sent_emails.
// Перемикач "падати" лежить у Redis, бо API і worker це різні процеси.
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { REDIS } from '../../common/redis.provider';
import { SentEmail } from './sent-email.entity';

export const EMAIL_FAILING_KEY = 'demo:email-provider:failing';

export type EmailMessage = { to: string; subject: string; body: string };

@Injectable()
export class FakeEmailProvider {
  constructor(@InjectRepository(SentEmail) private readonly sent: Repository<SentEmail>, @Inject(REDIS) private readonly redis: Redis) {}

  async send(message: EmailMessage, jobId: string | null): Promise<SentEmail> {
    if ((await this.redis.get(EMAIL_FAILING_KEY)) === '1') throw new Error('SMTP недоступний (демо-перемикач)');
    return this.sent.save(this.sent.create({ ...message, jobId }));
  }

  async setFailing(failing: boolean): Promise<void> {
    if (failing) await this.redis.set(EMAIL_FAILING_KEY, '1');
    else await this.redis.del(EMAIL_FAILING_KEY);
  }

  async isFailing(): Promise<boolean> {
    return (await this.redis.get(EMAIL_FAILING_KEY)) === '1';
  }
}
