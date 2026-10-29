// Єдиний формат помилок: { statusCode, code, message, requestId }.
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { RequestContext } from './request-context';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  constructor(private readonly ctx: RequestContext) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = this.ctx.requestId();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload: Record<string, unknown> =
        typeof body === 'string' ? { message: body } : { ...(body as Record<string, unknown>) };
      if (!payload.code) {
        payload.code = status === HttpStatus.BAD_REQUEST ? 'VALIDATION_ERROR' : httpCode(status);
      }
      res.status(status).json({ statusCode: status, requestId, ...payload });
      return;
    }

    this.logger.error(`Необроблена помилка (requestId=${requestId})`, exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Внутрішня помилка', requestId });
  }
}

function httpCode(status: number): string {
  switch (status) {
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 503: return 'SERVICE_UNAVAILABLE';
    default: return 'ERROR';
  }
}
