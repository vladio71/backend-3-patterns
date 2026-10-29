// Помилки домену з кодом, який бачить фронтенд. Фільтр перетворює їх на HTTP-відповідь { code, message, ... }.
import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, extra: Record<string, unknown> = {}) {
    super({ code, message, ...extra }, status);
  }
}

export function notFound(what: string): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} не знайдено`);
}

export function conflict(code: string, message: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError(HttpStatus.CONFLICT, code, message, extra);
}

export function badRequest(code: string, message: string): ApiError {
  return new ApiError(HttpStatus.BAD_REQUEST, code, message);
}

/** Postgres: порушення унікального ключа. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}
