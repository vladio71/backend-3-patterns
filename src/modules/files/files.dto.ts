import { IsIn, IsInt, IsString, MaxLength, Min } from 'class-validator';

export class PresignImageDto {
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType!: string;

  /** Розмір файлу в байтах. Сервер відмовить, якщо більше за MAX_IMAGE_BYTES (2 МБ). */
  @IsInt()
  @Min(1)
  size!: number;
}

export class ConfirmImageDto {
  @IsString()
  @MaxLength(300)
  key!: string;
}
