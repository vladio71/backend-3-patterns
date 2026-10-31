// Кореневий модуль API. Глобальні: JWT guard, фільтр помилок, middleware з контекстом запиту.
import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { VALIDATION_OPTIONS } from './common/validation';
import { RequestContextMiddleware } from './common/request-context.middleware';
import { dataSourceOptions } from './data-source';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { DemoModule } from './modules/demo/demo.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { FilesModule } from './modules/files/files.module';
import { HealthController } from './modules/health/health.controller';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ProductsModule } from './modules/products/products.module';
import { QueuesModule } from './modules/queues/queues.module';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forRoot(dataSourceOptions()),
    QueuesModule,
    AuthModule,
    AuditModule,
    FeatureFlagsModule,
    ProductsModule,
    OrdersModule,
    OutboxModule,
    PaymentsModule,
    CheckoutModule,
    FilesModule,
    NotificationsModule,
    DemoModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useValue: new ValidationPipe(VALIDATION_OPTIONS) },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
