// Версіонування API: /v1/products і /v2/products відрізняються формою price.
// /products без версії віддає форму, яку обирає прапорець products-v2-default.
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators';
import { AuthedRequest } from '../auth/jwt-auth.guard';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { Product } from './product.entity';
import { CreateProductDto, UpdateProductDto } from './products.dto';
import { ProductsService } from './products.service';

export type ProductV1 = { id: string; sku: string; name: string; price: number; currency: string; stock: number; version: number };
export type ProductV2 = { id: string; sku: string; name: string; price: { amount: number; currency: string }; stock: number; version: number };

export function toV1(p: Product): ProductV1 {
  return { id: p.id, sku: p.sku, name: p.name, price: p.priceCents, currency: p.currency, stock: p.stock, version: p.version };
}

export function toV2(p: Product): ProductV2 {
  return { id: p.id, sku: p.sku, name: p.name, price: { amount: p.priceCents, currency: p.currency }, stock: p.stock, version: p.version };
}

export const PRODUCTS_V2_FLAG = 'products-v2-default';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService, private readonly flags: FeatureFlagsService) {}

  @Version('1')
  @Get()
  async listV1(): Promise<ProductV1[]> {
    return (await this.products.list()).map(toV1);
  }

  @Version('2')
  @Get()
  async listV2(): Promise<ProductV2[]> {
    return (await this.products.list()).map(toV2);
  }

  /** Без версії: старий фронтенд отримує v1, поки прапорець не перемкне його на v2. */
  @Version(VERSION_NEUTRAL)
  @Get()
  async listDefault(@Req() req: AuthedRequest): Promise<Array<ProductV1 | ProductV2>> {
    const useV2 = await this.flags.isOn(PRODUCTS_V2_FLAG, req.user.sub);
    const rows = await this.products.list();
    return useV2 ? rows.map(toV2) : rows.map(toV1);
  }

  @Get('deleted')
  @Roles('admin')
  listDeleted(): Promise<Product[]> {
    return this.products.listDeleted();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Product> {
    return this.products.getOrFail(id);
  }

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateProductDto): Promise<Product> {
    return this.products.create(dto);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto): Promise<Product> {
    return this.products.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<Product> {
    return this.products.softDelete(id);
  }

  @Post(':id/restore')
  @Roles('admin')
  restore(@Param('id', ParseUUIDPipe) id: string): Promise<Product> {
    return this.products.restore(id);
  }
}
