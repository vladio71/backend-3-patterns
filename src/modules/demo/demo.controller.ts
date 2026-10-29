// Демо-перемикачі: стан платіжного провайдера і breaker-а, падіння email-провайдера, повільний і швидкий звіт, генерація даних.
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DataSource } from 'typeorm';
import { Roles } from '../../common/decorators';
import { RequestContext } from '../../common/request-context';
import { User } from '../auth/user.entity';
import { FakeEmailProvider } from '../notifications/fake-email.provider';
import { Order } from '../orders/order.entity';
import { OrderItem } from '../orders/order-item.entity';
import { FakePaymentProvider, ProviderState } from '../payments/fake-payment.provider';
import { BreakerView, PaymentClient } from '../payments/payment.client';
import { Product } from '../products/product.entity';
import { Report, ReportsService } from './reports.service';

export class ProviderStateDto {
  @IsBoolean()
  failing!: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  latencyMs?: number;
}

export class EmailStateDto {
  @IsBoolean()
  failing!: boolean;
}

@ApiTags('demo')
@ApiBearerAuth()
@Controller('demo')
export class DemoController {
  constructor(
    private readonly provider: FakePaymentProvider,
    private readonly client: PaymentClient,
    private readonly email: FakeEmailProvider,
    private readonly reports: ReportsService,
    private readonly dataSource: DataSource,
    private readonly ctx: RequestContext,
  ) {}

  @Roles('admin')
  @Post('payment-provider')
  async setProvider(@Body() dto: ProviderStateDto): Promise<ProviderState> {
    await this.provider.setState({ failing: dto.failing, latencyMs: dto.latencyMs ?? 0 });
    return this.provider.getState();
  }

  @Get('payment-provider/state')
  async providerState(): Promise<{ provider: ProviderState; breaker: BreakerView }> {
    return { provider: await this.provider.getState(), breaker: this.client.state() };
  }

  @Roles('admin')
  @Post('email-provider')
  async setEmail(@Body() dto: EmailStateDto): Promise<{ failing: boolean }> {
    await this.email.setFailing(dto.failing);
    return { failing: await this.email.isFailing() };
  }

  @Get('slow-report')
  slowReport(): Promise<Report> {
    return this.reports.slowReport();
  }

  @Get('fast-report')
  fastReport(): Promise<Report> {
    return this.reports.fastReport();
  }

  /** Наповнює tenant замовленнями для profiling: ?count=2000 (по 1..3 позиції в кожному). */
  @Roles('admin')
  @Post('generate-orders')
  async generateOrders(@Query('count') countRaw?: string): Promise<{ created: number }> {
    const count = Math.min(Math.max(Number(countRaw ?? 500), 1), 20_000);
    const tenantId = this.ctx.tenantIdOrFail();
    const userId = this.ctx.userId() as string;
    const products = await this.dataSource.getRepository(Product).find({ where: { tenantId } });
    if (products.length === 0) return { created: 0 };
    const user = await this.dataSource.getRepository(User).findOneByOrFail({ id: userId });

    await this.dataSource.transaction(async (manager) => {
      for (let i = 0; i < count; i++) {
        const picks = 1 + (i % 3);
        const items: OrderItem[] = [];
        let total = 0;
        for (let j = 0; j < picks; j++) {
          const product = products[(i * 7 + j * 3) % products.length];
          const qty = 1 + ((i + j) % 4);
          total += product.priceCents * qty;
          items.push(manager.create(OrderItem, { productId: product.id, qty, priceCents: product.priceCents }));
        }
        const status = i % 10 === 0 ? 'cancelled' : 'paid';
        await manager.save(Order, manager.create(Order, { tenantId, userId: user.id, status, totalCents: total, currency: 'UAH', items }));
      }
    });
    return { created: count };
  }
}
