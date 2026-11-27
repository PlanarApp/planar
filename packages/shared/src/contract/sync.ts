import { z } from 'zod';

const int = z.number().int();
const row = z.record(z.string(), z.unknown());

/** C-sync protocol version (C-sync v3): header `X-Sync-Protocol` and `protocol` in the body of `POST /sync/tasks`. */
export const SYNC_PROTOCOL = 3;
export const SYNC_PROTOCOL_HEADER = 'X-Sync-Protocol';
/** `POST /sync/tasks`: at most this many task ids per request */
export const SYNC_TASKS_MAX = 100;

export const syncBootstrapSchema = z.object({
  cursor: int,
  lastMutationId: int,
  data: z.record(z.string(), z.array(row)),
  /** v3: tasks whose details (detail entities) are in `data`; the client creates `_held` rows for them */
  held: z.array(z.uuid()).optional(),
  /** `?lean=1`: tasks come with `description: null`, the real ones — `GET /sync/bootstrap-heavy` */
  lean: z.boolean().optional(),
});

/** `GET /sync/bootstrap-heavy`: a page of task descriptions (id order); `next` — the `after` of the next page. */
export const syncHeavySchema = z.object({
  cursor: int,
  items: z.array(z.object({ id: z.uuid(), updatedAt: z.string(), description: z.unknown() })),
  next: z.uuid().optional(),
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
      /** v3: the task of a detail entity row (for `del` too); absent for core entities */
      taskId: z.uuid().optional(),
    }),
  ),
  reset: z.boolean().optional(),
  /** `?page=1` only: a page of the journal — `cursor` is the last returned seq, the client pulls again at once */
  more: z.boolean().optional(),
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

/** `POST /sync/tasks` (C-sync v3): a snapshot of task details. */
export const syncTasksRequestSchema = z.object({
  protocol: int,
  ids: z
    .array(z.uuid())
    .min(1)
    .max(SYNC_TASKS_MAX)
    .refine((ids) => new Set(ids).size === ids.length, 'ids must be unique'),
});

export const syncTasksResponseSchema = z.object({
  cursor: int,
  tasks: z.array(
    z.discriminatedUnion('status', [
      z.object({
        taskId: z.uuid(),
        status: z.literal('ok'),
        comments: z.array(row),
        commentReactions: z.array(row),
      }),
      z.object({ taskId: z.uuid(), status: z.enum(['forbidden', 'not_found']) }),
    ]),
  ),
});

export const wsServerSchema = z.object({ t: z.literal('poke'), seq: int });
export const wsClientSchema = z.object({ t: z.literal('hello'), cursor: int });
/** «Typing…» (C-sync v2): client → server and server → clients. */
export const wsTypingClientSchema = z.object({
  t: z.literal('typing'),
  entity: z.string().min(1),
  id: z.string().min(1),
});
export const wsTypingServerSchema = wsTypingClientSchema.extend({ userId: z.string() });
/** PLNRAPP-884: background work of a row changed (an AI run of a task): the client reloads it, no polling. */
export const wsWorkServerSchema = z.object({
  t: z.literal('work'),
  entity: z.string().min(1),
  id: z.string().min(1),
  projectId: z.string().nullable(),
});

export type SyncBootstrap = z.infer<typeof syncBootstrapSchema>;
export type SyncHeavy = z.infer<typeof syncHeavySchema>;
export type SyncPull = z.infer<typeof syncPullSchema>;
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;
export type SyncTasksRequest = z.infer<typeof syncTasksRequestSchema>;
export type SyncTasksResponse = z.infer<typeof syncTasksResponseSchema>;
