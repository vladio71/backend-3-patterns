import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../../common/decorators';
import { QUEUES, Queues } from '../queues/queues.module';
import { SentEmail } from './sent-email.entity';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(@InjectRepository(SentEmail) private readonly sent: Repository<SentEmail>, @Inject(QUEUES) private readonly queues: Queues) {}

  /** Листи, які "надіслав" фейковий провайдер. Фільтр ?to=email. */
  @Roles('admin')
  @Get('emails')
  list(@Query('to') to?: string): Promise<SentEmail[]> {
    return this.sent.find({ where: to ? { to } : {}, order: { sentAt: 'DESC' }, take: 100 });
  }

  /** Що лежить у DLQ: тіло job і причина. */
  @Roles('admin')
  @Get('dlq')
  async dlq(): Promise<Array<{ id: string | undefined; data: unknown }>> {
    const jobs = await this.queues.notificationsDlq.getJobs(['waiting', 'completed', 'failed', 'delayed'], 0, 100);
    return jobs.map((job) => ({ id: job.id, data: job.data }));
  }
}
