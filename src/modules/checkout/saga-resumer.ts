// Worker: раз на кілька секунд шукає саґи, які "зависли" (running довше за SAGA_RESUME_AFTER_MS), і доводить їх до кінця.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, LessThan } from 'typeorm';
import { AppConfig, CONFIG } from '../../common/config';
import { RequestContext, runWithTenant } from '../../common/request-context';
import { CheckoutSaga } from './checkout-saga.entity';
import { CheckoutService } from './checkout.service';

@Injectable()
export class SagaResumer {
  private readonly logger = new Logger(SagaResumer.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly checkout: CheckoutService,
    private readonly ctx: RequestContext,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((e) => this.logger.error(String(e))), this.config.saga.resumePollMs);
    this.logger.log('SagaResumer запущено');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Повертає кількість підхоплених саґ. */
  async tick(): Promise<number> {
    const stale = new Date(Date.now() - this.config.saga.resumeAfterMs);
    const sagas = await this.dataSource.getRepository(CheckoutSaga).find({
      where: [{ status: 'running', updatedAt: LessThan(stale) }, { status: 'compensating', updatedAt: LessThan(stale) }],
      take: 20,
    });
    for (const saga of sagas) {
      this.logger.warn(`Підхоплюю саґу ${saga.id} (status=${saga.status}, step=${saga.step})`);
      await runWithTenant(this.ctx, saga.tenantId, null, async () => {
        try {
          if (saga.status === 'compensating') await this.checkout.compensate(saga);
          else await this.checkout.run(saga);
        } catch (error) {
          this.logger.warn(`Саґа ${saga.id} завершилась помилкою: ${(error as Error).message}`);
        }
      });
    }
    return sagas.length;
  }
}
