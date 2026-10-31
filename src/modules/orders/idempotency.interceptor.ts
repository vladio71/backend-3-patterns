// Idempotency-Key для POST /orders: той самий ключ і те саме тіло віддають збережену відповідь
// із заголовком Idempotent-Replayed: true. Той самий ключ з іншим тілом це 409.
import { CallHandler, ExecutionContext, HttpStatus, Injectable, NestInterceptor, ValidationPipe } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Request, Response } from 'express';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { DataSource } from 'typeorm';
import { ApiError, badRequest, conflict, isUniqueViolation } from '../../common/errors';
import { RequestContext } from '../../common/request-context';
import { VALIDATION_OPTIONS, canonicalJson } from '../../common/validation';
import { IdempotencyKey } from './idempotency-key.entity';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly pipe = new ValidationPipe(VALIDATION_OPTIONS);

  constructor(private readonly dataSource: DataSource, private readonly ctx: RequestContext) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = req.header('idempotency-key');
    if (!key) return next.handle(); // без ключа працюємо як звичайний POST
    if (key.length > 200) throw new ApiError(HttpStatus.BAD_REQUEST, 'IDEMPOTENCY_KEY_TOO_LONG', 'Idempotency-Key довший за 200 символів');

    // Ключ належить парі (tenant, користувач). Лише tenant було б мало: два користувачі з однаковим Idempotency-Key
    // (скажімо, "1") отримали б один одного відповідь, тобто чуже замовлення з чужими даними.
    const tenantId = this.ctx.tenantIdOrFail();
    const userId = this.ctx.userId();
    if (!userId) throw badRequest('NO_USER', 'Немає користувача в контексті');
    // Інтерцептор працює ДО глобального ValidationPipe, тому req.body тут сире: з зайвими полями і в довільному порядку ключів.
    // Хешувати його не можна: {items} і {items, foo: 1}, а також різний порядок ключів дали б різні хеші для одного й того самого
    // замовлення, і чесний повтор клієнта отримав би 409. Тому проганяємо тіло через той самий ValidationPipe
    // (whitelist: зайві поля відрізаються) і хешуємо канонічний JSON. Невалідне тіло дає 400 ще до запису ключа.
    const dto = await this.pipe.transform(req.body ?? {}, { type: 'body', metatype: bodyType(context) });
    const requestHash = createHash('sha256').update(canonicalJson(dto)).digest('hex');
    const repo = this.dataSource.getRepository(IdempotencyKey);

    try {
      await repo.insert({ tenantId, userId, key, requestHash }); // statusCode і responseBody поки NULL: запит у роботі
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await repo.findOneOrFail({ where: { tenantId, userId, key } });
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
      mergeMap((body) => from(repo.update({ tenantId, userId, key }, { statusCode: res.statusCode, responseBody: (body ?? {}) as object })).pipe(mergeMap(() => of(body)))),
      catchError((error) => from(repo.delete({ tenantId, userId, key })).pipe(mergeMap(() => throwError(() => error)))), // помилка: ключ звільняємо, клієнт може повторити
    );
  }
}

/** Клас DTO з параметрів обробника (Nest зберігає їх через emitDecoratorMetadata): так інтерцептор не прив'язаний до CreateOrderDto. */
function bodyType(context: ExecutionContext): new () => object {
  const types = Reflect.getMetadata('design:paramtypes', context.getClass().prototype, context.getHandler().name) as Array<new () => object> | undefined;
  const dtoType = types?.find((type) => type !== Object && type !== String && type !== Number && type !== Boolean && type !== Array);
  if (!dtoType) throw new Error('IdempotencyInterceptor: у обробника немає DTO для хешування тіла');
  return dtoType;
}
