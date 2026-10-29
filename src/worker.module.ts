// Модуль worker-процесу: ті самі сутності й сервіси, але без HTTP-контролерів.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from './common/common.module';
import { dataSourceOptions } from './data-source';
import { AuditModule } from './modules/audit/audit.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { QueuesModule } from './modules/queues/queues.module';

@Module({
  imports: [CommonModule, TypeOrmModule.forRoot(dataSourceOptions()), QueuesModule, AuditModule, OutboxModule, NotificationsModule, CheckoutModule],
})
export class WorkerModule {}
