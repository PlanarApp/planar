import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { HttpErrorCode } from '@planar/shared';

/** Ошибка C-http с явным кодом (общий фильтр выводит код только из статуса). */
export class HttpError extends HttpException {
  constructor(
    status: number,
    readonly code: HttpErrorCode,
    message: string,
  ) {
    super(message, status);
  }
}

@Catch(HttpError)
export class HttpErrorFilter implements ExceptionFilter {
  catch(err: HttpError, host: ArgumentsHost) {
    void host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(err.getStatus())
      .send({ code: err.code, message: err.message });
  }
}
