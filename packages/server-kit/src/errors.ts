import { HttpException } from '@nestjs/common';
import type { HttpErrorCode } from '@planar/shared';
import type { z } from 'zod';

/** C-http error with an explicit code; the common ErrorFilter takes the code from here. */
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

/** zod parsing of the body: error → 400 invalid_request with issues. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, 'invalid_request', 'Неверный запрос', r.error.issues);
  return r.data;
}
