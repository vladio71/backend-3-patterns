import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators';
import { ConfirmImageDto, PresignImageDto } from './files.dto';
import { FilesService, ImageView, PresignResult } from './files.service';

@ApiTags('files')
@ApiBearerAuth()
@Controller('products/:id/images')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** Крок 1: отримати URL для прямого PUT у сховище. */
  @Post('presign')
  @Roles('admin')
  presign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PresignImageDto): Promise<PresignResult> {
    return this.files.presign(id, dto.contentType, dto.size);
  }

  /** Крок 3 (крок 2 робить браузер): підтвердити, що файл лежить у сховищі. */
  @Post('confirm')
  @Roles('admin')
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmImageDto): Promise<ImageView> {
    return this.files.confirm(id, dto.key);
  }

  @Get()
  list(@Param('id', ParseUUIDPipe) id: string): Promise<ImageView[]> {
    return this.files.list(id);
  }

  @Delete(':imageId')
  @Roles('admin')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string): Promise<{ ok: true }> {
    await this.files.remove(id, imageId);
    return { ok: true };
  }
}
