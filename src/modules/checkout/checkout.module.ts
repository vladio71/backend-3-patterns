import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersModule } from '../orders/orders.module';
import { OutboxModule } from '../outbox/outbox.module';
import { PaymentsModule } from '../payments/payments.module';
import { CheckoutSaga } from './checkout-saga.entity';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { SagaResumer } from './saga-resumer';
import { Shipment } from './shipment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CheckoutSaga, Shipment]), OrdersModule, PaymentsModule, OutboxModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, SagaResumer],
  exports: [CheckoutService, SagaResumer],
})
export class CheckoutModule {}
