import { z } from 'zod';

export const HTTP_ERROR_CODES = [
  'invalid_request',
  'unauthenticated',
  'invalid_credentials',
  'forbidden',
  'origin_mismatch',
  'not_found',
  'module_disabled',
  'conflict',
  'payload_too_large',
  'rate_limited',
  'internal',
  'unavailable',
] as const;

export type HttpErrorCode = (typeof HTTP_ERROR_CODES)[number];

export const httpErrorSchema = z.object({
  code: z.enum(HTTP_ERROR_CODES),
  message: z.string(),
  details: z.unknown().optional(),
});

export type HttpError = z.infer<typeof httpErrorSchema>;

/** Тело Web Push (C-http «Web Push»): отправляет CR-7, разбирает service worker web. */
export const pushPayloadSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  // только путь приложения: '/x', не '//host' и не '/\\host' (иначе SW откроет чужой сайт)
  url: z.string().regex(/^\/(?![/\\])/),
  tag: z.uuid(),
  kind: z.enum([
    'assigned',
    'mentioned',
    'commented',
    'status_changed',
    'chat_mention',
    'chat_dm',
    'chat_reply',
  ]),
});

export type PushPayload = z.infer<typeof pushPayloadSchema>;
