import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsString, Max, Min } from 'class-validator';

export class UpsertFlagDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(0)
  @Max(100)
  percentage!: number;

  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  allowlist!: string[];
}
