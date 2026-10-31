import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../../common/decorators';
import { RequestContext } from '../../common/request-context';
import { QUEUES, Queues } from '../queues/queues.module';
import { SentEmail } from './sent-email.entity';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    @InjectRepository(SentEmail) private readonly sent: Repository<SentEmail>,
    @Inject(QUEUES) private readonly queues: Queues,
    private readonly ctx: RequestContext,
  ) {}

  /** Листи свого tenant, які "надіслав" фейковий провайдер. Фільтр ?to=email. Листи без tenant (tenant_id NULL) не показуємо. */
  @Roles('admin')
  @Get('emails')
  list(@Query('to') to?: string): Promise<SentEmail[]> {
    return this.sent.find({ where: { tenantId: this.ctx.tenantIdOrFail(), ...(to ? { to } : {}) }, order: { sentAt: 'DESC' }, take: 100 });
  }

  /**
   * Що лежить у DLQ: тіло job і причина. Лише листи поточного tenant (job.data.tenantId).
   * Job-и без tenantId (старі, до цієї зміни, або системні) не показуємо нікому: краще сховати, ніж віддати чужий лист.
   */
  @Roles('admin')
  @Get('dlq')
  async dlq(): Promise<Array<{ id: string | undefined; data: unknown }>> {
    const tenantId = this.ctx.tenantIdOrFail();
    const jobs = await this.queues.notificationsDlq.getJobs(['waiting', 'completed', 'failed', 'delayed'], 0, 100);
    return jobs.filter((job) => (job.data as { tenantId?: string | null }).tenantId === tenantId).map((job) => ({ id: job.id, data: job.data }));
  }
}
