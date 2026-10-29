// Middleware: кожен HTTP-запит отримує requestId і власний AsyncLocalStorage-контекст.
import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly ctx: RequestContext) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();
    res.setHeader('X-Request-Id', requestId);
    this.ctx.run({ requestId, userId: null, tenantId: null, role: null }, () => next());
  }
}
