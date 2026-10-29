import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConsumedEvent } from './consumed-event.entity';
import { EventsConsumer } from './events.consumer';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxRelay } from './outbox.relay';
import { OutboxService } from './outbox.service';

@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent, ConsumedEvent]), NotificationsModule],
  providers: [OutboxService, OutboxRelay, EventsConsumer],
  exports: [OutboxService, OutboxRelay, EventsConsumer],
})
export class OutboxModule {}
