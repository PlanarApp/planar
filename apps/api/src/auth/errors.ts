import { HttpException } from '@nestjs/common';
import type { HttpErrorCode } from '@planar/shared';

/** Ошибка C-http с явным кодом; общий ErrorFilter берёт код отсюда. */
export class HttpError extends HttpException {
  constructor(
    status: number,
    readonly code: HttpErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}
