// Одні й ті самі опції ValidationPipe для всього застосунку (AppModule) і для IdempotencyInterceptor,
// щоб хеш ідемпотентності рахувався від того самого "очищеного" тіла, яке потім побачить обробник.
import { ValidationPipeOptions } from '@nestjs/common';

export const VALIDATION_OPTIONS: ValidationPipeOptions = { whitelist: true, transform: true, forbidNonWhitelisted: false };

/** JSON із відсортованими ключами: {a:1,b:2} і {b:2,a:1} дають однаковий рядок. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}
