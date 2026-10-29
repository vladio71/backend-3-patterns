// Idempotency-Key для POST /orders: той самий ключ і те саме тіло віддають збережену відповідь
// із заголовком Idempotent-Replayed: true. Той самий ключ з іншим тілом це 409.
import { CallHandler, ExecutionContext, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Request, Response } from 'express';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { DataSource } from 'typeorm';
import { ApiError, conflict, isUniqueViolation } from '../../common/errors';
import { RequestContext } from '../../common/request-context';
import { IdempotencyKey } from './idempotency-key.entity';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly dataSource: DataSource, private readonly ctx: RequestContext) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = req.header('idempotency-key');
    if (!key) return next.handle(); // без ключа працюємо як звичайний POST
    if (key.length > 200) throw new ApiError(HttpStatus.BAD_REQUEST, 'IDEMPOTENCY_KEY_TOO_LONG', 'Idempotency-Key довший за 200 символів');

    const tenantId = this.ctx.tenantIdOrFail();
    const requestHash = createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');
    const repo = this.dataSource.getRepository(IdempotencyKey);

    try {
      await repo.insert({ tenantId, key, requestHash }); // statusCode і responseBody поки NULL: запит у роботі
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await repo.findOneOrFail({ where: { tenantId, key } });
      if (existing.requestHash !== requestHash) {
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'Цей Idempotency-Key уже використано з іншим тілом запиту');
      }
      if (existing.statusCode === null) {
        throw conflict('IDEMPOTENCY_IN_PROGRESS', 'Запит із цим ключем ще обробляється');
      }
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(existing.statusCode);
      return of(existing.responseBody);
    }

    return next.handle().pipe(
      mergeMap((body) => from(repo.update({ tenantId, key }, { statusCode: res.statusCode, responseBody: (body ?? {}) as object })).pipe(mergeMap(() => of(body)))),
      catchError((error) => from(repo.delete({ tenantId, key })).pipe(mergeMap(() => throwError(() => error)))), // помилка: ключ звільняємо, клієнт може повторити
    );
  }
}
