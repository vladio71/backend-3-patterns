import { Body, Controller, Delete, Get, Param, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators';
import { notFound } from '../../common/errors';
import { AuthedRequest } from '../auth/jwt-auth.guard';
import { UpsertFlagDto } from './feature-flags.dto';
import { FeatureFlagsService, FlagView } from './feature-flags.service';

@ApiTags('feature-flags')
@ApiBearerAuth()
@Controller()
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  /** Будь-який користувач: чи увімкнено прапорець саме для мене. */
  @Get('flags/:key')
  async check(@Param('key') key: string, @Req() req: AuthedRequest): Promise<{ key: string; on: boolean }> {
    return { key, on: await this.flags.isOn(key, req.user.sub) };
  }

  @Roles('admin')
  @Get('admin/flags')
  list(): Promise<FlagView[]> {
    return this.flags.list();
  }

  @Roles('admin')
  @Get('admin/flags/:key')
  async get(@Param('key') key: string): Promise<FlagView> {
    const flag = await this.flags.get(key);
    if (!flag) throw notFound('Прапорець');
    return flag;
  }

  @Roles('admin')
  @Put('admin/flags/:key')
  upsert(@Param('key') key: string, @Body() dto: UpsertFlagDto): Promise<FlagView> {
    return this.flags.upsert(key, dto);
  }

  @Roles('admin')
  @Delete('admin/flags/:key')
  async remove(@Param('key') key: string): Promise<{ ok: true }> {
    await this.flags.remove(key);
    return { ok: true };
  }
}
