import type { z } from 'zod';
import { HttpError } from './errors.js';

/** zod-разбор тела: ошибка → 400 invalid_request с issues. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, 'invalid_request', 'Неверный запрос', r.error.issues);
  return r.data;
}
