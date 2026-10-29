// Декоратори авторизації: @Public() вимикає JWT-перевірку, @Roles('admin') вимагає роль.
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: string[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES, roles);
