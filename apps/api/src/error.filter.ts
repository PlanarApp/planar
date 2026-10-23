import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { HttpErrorCode } from '@planar/shared';
import { HttpError } from './auth/errors.js';

const byStatus: Record<number, HttpErrorCode> = {
  400: 'invalid_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  429: 'rate_limited',
  503: 'unavailable',
};

/** Любая ошибка → формат C-http {code, message, details?}. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<FastifyReply>();
    const status = err instanceof HttpException ? err.getStatus() : 500;
    const code = err instanceof HttpError ? err.code : (byStatus[status] ?? 'internal');
    const message = err instanceof HttpException ? err.message : 'Внутренняя ошибка';
    if (status >= 500) res.log.error(err);
    void res.status(status).send({
      code,
      message,
      ...(err instanceof HttpError && err.details !== undefined && { details: err.details }),
    });
  }
}
