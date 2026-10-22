import { z } from 'zod';

const int = z.number().int();
const row = z.record(z.string(), z.unknown());

export const syncBootstrapSchema = z.object({
  cursor: int,
  lastMutationId: int,
  data: z.record(z.string(), z.array(row)),
});

export const syncPullSchema = z.object({
  cursor: int,
  lastMutationId: int,
  changes: z.array(
    z.object({
      seq: int,
      entity: z.string(),
      id: z.string(),
      op: z.enum(['put', 'del']),
      data: row.optional(),
    }),
  ),
  reset: z.boolean().optional(),
});

export const syncPushRequestSchema = z.object({
  clientId: z.uuid(),
  mutations: z
    .array(z.object({ id: int.positive(), name: z.string(), args: z.unknown() }))
    .max(100),
});

export const PUSH_ERROR_CODES = [
  'invalid_args',
  'forbidden',
  'not_found',
  'conflict',
  'unknown_mutator',
  'internal',
] as const;

export const syncPushResponseSchema = z.object({
  results: z.array(
    z.union([
      z.object({ id: int, ok: z.literal(true) }),
      z.object({
        id: int,
        ok: z.literal(false),
        code: z.enum(PUSH_ERROR_CODES),
        message: z.string(),
      }),
    ]),
  ),
});

export const wsServerSchema = z.object({ t: z.literal('poke'), seq: int });
export const wsClientSchema = z.object({ t: z.literal('hello'), cursor: int });

export type SyncBootstrap = z.infer<typeof syncBootstrapSchema>;
export type SyncPull = z.infer<typeof syncPullSchema>;
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;
