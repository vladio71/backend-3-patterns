import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/** Подія від платіжного провайдера. eventId унікальний для кожної події, а не для кожної доставки. */
export class PaymentWebhookDto {
  @IsString()
  @MaxLength(100)
  eventId!: string;

  @IsIn(['payment.succeeded'])
  type!: string;

  @IsUUID()
  orderId!: string;

  @IsInt()
  @Min(0)
  amountCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  paymentRef?: string;
}
