import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @Matches(/^[A-Za-z0-9-]{2,40}$/)
  sku!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsInt()
  @Min(0)
  stock!: number;
}

/** PATCH вимагає version, яку клієнт бачив востаннє. Без неї сервер не знає, чи дані застаріли. */
export class UpdateProductDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;
}
