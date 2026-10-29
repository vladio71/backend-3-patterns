import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';
import { Roles } from '../../common/decorators';
import { AuditLog } from './audit-log.entity';
import { AuditService } from './audit.service';

export class AuditQueryDto {
  @IsIn(['product', 'order'])
  entity!: string;

  @IsUUID()
  entityId!: string;
}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Журнал змін одного запису. Лише admin: у before/after можуть бути чутливі поля. */
  @Roles('admin')
  @Get()
  list(@Query() query: AuditQueryDto): Promise<AuditLog[]> {
    return this.audit.list(query.entity, query.entityId);
  }
}
