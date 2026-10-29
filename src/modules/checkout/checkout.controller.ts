import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CheckoutSaga } from './checkout-saga.entity';
import { CheckoutDto } from './checkout.dto';
import { CheckoutResult, CheckoutService } from './checkout.service';

@ApiTags('checkout')
@ApiBearerAuth()
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /** X-Fail-Payment: 1 змушує провайдера відхилити платіж. X-Crash-After: reserve_stock імітує падіння процесу після кроку. */
  @Post()
  @ApiHeader({ name: 'X-Fail-Payment', required: false })
  @ApiHeader({ name: 'X-Crash-After', required: false })
  run(
    @Body() dto: CheckoutDto,
    @Headers('x-fail-payment') failPayment: string | undefined,
    @Headers('x-crash-after') crashAfter: string | undefined,
  ): Promise<CheckoutResult> {
    return this.checkout.checkout(dto.items, dto.address, failPayment === '1', crashAfter ?? null);
  }

  @Get('sagas/:id')
  saga(@Param('id', ParseUUIDPipe) id: string): Promise<CheckoutSaga> {
    return this.checkout.getSaga(id);
  }
}
