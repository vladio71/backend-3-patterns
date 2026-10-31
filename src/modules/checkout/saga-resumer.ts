// Worker: раз на кілька секунд шукає саґи, які "зависли" (running довше за SAGA_RESUME_AFTER_MS), і доводить їх до кінця.
// Перед тим як узятися за саґу, resumer її "захоплює" (claim): тільки той, чий UPDATE зачепив рядок, її виконує.
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
      order: { updatedAt: 'ASC' }, // найдовше покинуті першими; без ORDER BY при >20 зависших саґ частину можна ніколи не дістати
      take: 20,
    });
    let resumed = 0;
    for (const saga of sagas) {
      if (!(await this.claim(saga, stale))) continue; // цю саґу вже взяв інший resumer (або вона ожила сама)
      resumed += 1;
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
    return resumed;
  }

  /**
   * UPDATE checkout_sagas SET updated_at = now() WHERE id = $1 AND status = $2 AND updated_at < $stale.
   * Postgres виконує такий UPDATE для одного рядка по черзі: перший resumer змінює updated_at, і умова
   * "updated_at < stale" для другого стає хибною, тобто affected = 0. Без цього два екземпляри worker-а (або два тики)
   * отримали б той самий список, і обидва виконали б одну саґу: двічі charge, двічі shipment.
   * Заодно оновлений updated_at каже іншим, що саґа в роботі.
   */
  private async claim(saga: CheckoutSaga, stale: Date): Promise<boolean> {
    const result = await this.dataSource.createQueryBuilder()
      .update(CheckoutSaga)
      .set({ updatedAt: () => 'now()' })
      .where('id = :id AND status = :status AND updated_at < :stale', { id: saga.id, status: saga.status, stale })
      .execute();
    return result.affected === 1;
  }
}
