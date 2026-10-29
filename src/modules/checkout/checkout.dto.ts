import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength, ValidateNested } from 'class-validator';
import { OrderItemDto } from '../orders/orders.dto';

export class CheckoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @IsString()
  @MaxLength(300)
  address!: string;
}
