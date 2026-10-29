// POST /payments/webhook: публічний, але підписаний HMAC. Потрібне сире тіло (rawBody: true в main.ts).
import { Body, Controller, Headers, HttpCode, Inject, Post, RawBodyRequest, Req, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AppConfig, CONFIG } from '../../common/config';
import { Public } from '../../common/decorators';
import { PaymentWebhookDto } from './payments.dto';
import { PaymentsService, WebhookResult } from './payments.service';
import { verifyWebhookSignature } from './webhook-signature';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService, @Inject(CONFIG) private readonly config: AppConfig) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-signature') signature: string | undefined, @Body() dto: PaymentWebhookDto): Promise<WebhookResult> {
    const raw = req.rawBody ?? Buffer.from('');
    if (!verifyWebhookSignature(raw, signature, this.config.webhookSecret)) throw new UnauthorizedException('Невірний підпис вебхука');
    return this.payments.handlePaymentSucceeded(dto);
  }
}
