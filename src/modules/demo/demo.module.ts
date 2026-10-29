import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { DemoController } from './demo.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [PaymentsModule, NotificationsModule],
  controllers: [DemoController],
  providers: [ReportsService],
})
export class DemoModule {}
