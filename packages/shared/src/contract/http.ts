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

/** Web Push body (C-http «Web Push»): sent by CR-7, parsed by the web service worker. */
export const pushPayloadSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  // app path only: '/x', not '//host' and not '/\\host' (otherwise the SW would open a foreign site)
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
