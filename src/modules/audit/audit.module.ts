import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit-log.entity';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditSubscriber } from './audit.subscriber';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditController],
  providers: [AuditService, AuditSubscriber],
  exports: [AuditService],
})
export class AuditModule {}
