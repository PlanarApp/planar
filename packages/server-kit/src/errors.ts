import { HttpException } from '@nestjs/common';
import type { HttpErrorCode } from '@planar/shared';
import type { z } from 'zod';

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

/** zod-разбор тела: ошибка → 400 invalid_request с issues. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, 'invalid_request', 'Неверный запрос', r.error.issues);
  return r.data;
}
