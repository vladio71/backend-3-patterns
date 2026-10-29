import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { Order } from './order.entity';
import { CreateOrderDto } from './orders.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(): Promise<Order[]> {
    return this.orders.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Order> {
    return this.orders.getOrFail(id);
  }

  /** Створює замовлення у статусі pending. З Idempotency-Key повтор запиту безпечний. */
  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @UseInterceptors(IdempotencyInterceptor)
  create(@Body() dto: CreateOrderDto): Promise<Order> {
    return this.orders.create(dto.items);
  }
}
