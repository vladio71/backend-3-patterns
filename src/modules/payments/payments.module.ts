import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxModule } from '../outbox/outbox.module';
import { FakePaymentProvider } from './fake-payment.provider';
import { Payment } from './payment.entity';
import { PaymentClient } from './payment.client';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ProcessedWebhookEvent } from './processed-webhook-event.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Payment, ProcessedWebhookEvent]), OutboxModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, FakePaymentProvider, PaymentClient],
  exports: [PaymentsService, FakePaymentProvider, PaymentClient],
})
export class PaymentsModule {}
