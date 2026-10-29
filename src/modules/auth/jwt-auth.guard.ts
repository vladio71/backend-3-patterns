// Глобальний guard: читає Bearer-токен, кладе userId/tenantId/role в RequestContext, перевіряє @Roles.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC, ROLES } from '../../common/decorators';
import { RequestContext } from '../../common/request-context';
import { AuthService, JwtClaims } from './auth.service';

export type AuthedRequest = Request & { user: JwtClaims };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService, private readonly ctx: RequestContext) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.header('authorization') ?? '';
    if (!header.startsWith('Bearer ')) throw new UnauthorizedException('Потрібен Bearer-токен');
    let claims: JwtClaims;
    try {
      claims = this.auth.verify(header.slice(7));
    } catch {
      throw new UnauthorizedException('Невірний або прострочений токен');
    }
    req.user = claims;
    this.ctx.setUser(claims.sub, claims.tenantId, claims.role);

    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES, targets);
    if (roles && roles.length > 0 && !roles.includes(claims.role)) throw new ForbiddenException('Недостатньо прав');
    return true;
  }
}
