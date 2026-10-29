import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/, { message: 'tenantSlug: лише a-z, 0-9 і дефіс' })
  tenantSlug!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

export class LoginDto {
  @IsString()
  tenantSlug!: string;

  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}
