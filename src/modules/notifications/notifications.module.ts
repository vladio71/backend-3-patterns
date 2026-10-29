import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailWorker } from './email.worker';
import { FakeEmailProvider } from './fake-email.provider';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { SentEmail } from './sent-email.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SentEmail])],
  controllers: [NotificationsController],
  providers: [NotificationsService, FakeEmailProvider, EmailWorker],
  exports: [NotificationsService, FakeEmailProvider, EmailWorker],
})
export class NotificationsModule {}
