import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxModule } from '../outbox/outbox.module';
import { IdempotencyKey } from './idempotency-key.entity';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { OrderItem } from './order-item.entity';
import { Order } from './order.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order, OrderItem, IdempotencyKey]), OutboxModule],
  controllers: [OrdersController],
  providers: [OrdersService, IdempotencyInterceptor],
  exports: [OrdersService],
})
export class OrdersModule {}
