import { isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError } from '../auth/errors.js';
import * as s from '../db/schema.js';
import { parse, type RestService } from './rest.service.js';

const uuid = z.uuid();
const date = z.iso.date();

/** Extra task filters (PLNRAPP-268): the same names in GET /tasks, search_tasks and the batch `filter`. */
export const extraFilter = {
  labelId: uuid.optional(),
  priority: z.number().int().min(0).max(4).optional(),
  dueBefore: date.optional().describe('срок раньше этой даты'),
  dueAfter: date.optional().describe('срок позже этой даты'),
  unassigned: z.boolean().optional().describe('true — без исполнителя'),
  archived: z.boolean().optional().describe('true — только задачи из архива'),
};

type Extra = { [K in keyof typeof extraFilter]?: z.infer<(typeof extraFilter)[K]> };

/** where-conditions of the extra filters (archived is handled by the caller: it replaces isNull(archivedAt)) */
export const extraConds = (q: Extra): (SQL | undefined)[] => [
  q.archived ? isNotNull(s.tasks.archivedAt) : isNull(s.tasks.archivedAt),
  q.labelId
    ? sql`exists (select 1 from ${s.taskLabels} l where l.task_id = ${s.tasks.id} and l.label_id = ${q.labelId})`
    : undefined,
  q.priority !== undefined ? sql`${s.tasks.priority} = ${q.priority}` : undefined,
  q.dueBefore ? sql`${s.tasks.dueDate} < ${q.dueBefore}::date` : undefined,
  q.dueAfter ? sql`${s.tasks.dueDate} > ${q.dueAfter}::date` : undefined,
  q.unassigned
    ? sql`not exists (select 1 from ${s.taskAssignees} a where a.task_id = ${s.tasks.id})`
    : undefined,
];

export const taskFilter = z
  .object({
    query: z.string().optional(),
    projectId: uuid.optional(),
    statusId: uuid.optional(),
    statusCategory: z.enum(['backlog', 'todo', 'in_progress', 'done', 'cancelled']).optional(),
    assigneeId: z.union([uuid, z.literal('me')]).optional(),
    ...extraFilter,
  })
  .refine((f) => Object.values(f).some((v) => v !== undefined), 'filter не должен быть пустым');

const addRemove = z.object({ add: z.array(uuid).optional(), remove: z.array(uuid).optional() });
export const batchPatch = z
  .object({
    statusId: uuid.optional(),
    labelIds: addRemove.optional(),
    assigneeIds: addRemove.optional(),
    fields: z.record(uuid, z.unknown()).optional(),
    archived: z.boolean().optional().describe('true — в архив, false — вернуть из архива'),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'patch не должен быть пустым');

export const batchBody = z
  .object({
    taskIds: z.array(z.string().min(1)).min(1).max(100).optional().describe('id или ключи, ≤ 100'),
    filter: taskFilter.optional().describe('вместо taskIds: те же условия, что в search_tasks'),
    patch: batchPatch,
    dryRun: z.boolean().optional().describe('true — только список задач, ничего не менять'),
  })
  .refine(
    (b) => (b.taskIds === undefined) !== (b.filter === undefined),
    'нужен ровно один из taskIds и filter',
  );

export const batchResult = z.object({
  matched: z.array(z.object({ id: z.string(), key: z.string().nullable(), title: z.string() })),
  changed: z.number().int(),
  errors: z.array(z.object({ task: z.string(), code: z.string() })),
});
export type BatchResult = z.infer<typeof batchResult>;

const LIMIT = 100;

/** Each task goes through the same mutators as PATCH /tasks/:task — rights are theirs; one failure does not stop the rest. */
export async function batchTasks(
  rest: RestService,
  userId: string,
  raw: unknown,
  tokenId?: string,
): Promise<{ data: BatchResult }> {
  const b = parse(batchBody, raw);
  const errors: BatchResult['errors'] = [];
  const matched: BatchResult['matched'] = [];
  if (b.filter) {
    const found = await rest.searchTasks(userId, { ...b.filter, limit: LIMIT + 1 });
    if (found.length > LIMIT)
      throw new HttpError(400, 'invalid_request', `фильтр даёт больше ${LIMIT} задач — сузьте его`);
    for (const t of found) matched.push({ id: t.id, key: t.key, title: t.title });
  } else {
    for (const ref of b.taskIds!)
      try {
        const t = (await rest.task(userId, ref)).data;
        matched.push({ id: t.id, key: t.key, title: t.title });
      } catch (e) {
        errors.push({ task: ref, code: e instanceof HttpError ? e.code : 'internal' });
      }
  }
  if (b.dryRun) return { data: { matched, changed: 0, errors } };
  const { archived, labelIds, assigneeIds, ...rest0 } = b.patch;
  let changed = 0;
  for (const t of matched) {
    try {
      const patch: Record<string, unknown> = { ...rest0 };
      if (labelIds || assigneeIds) {
        const cur = (await rest.task(userId, t.id)).data;
        const merge = (now: string[], d?: { add?: string[]; remove?: string[] }) => [
          ...new Set([...now, ...(d?.add ?? [])].filter((x) => !d?.remove?.includes(x))),
        ];
        if (labelIds) patch.labelIds = merge(cur.labelIds, labelIds);
        if (assigneeIds) patch.assigneeIds = merge(cur.assigneeIds, assigneeIds);
      }
      if (Object.keys(patch).length) await rest.patchTask(userId, t.id, patch, tokenId);
      if (archived !== undefined) await rest.archiveTask(userId, t.id, archived, tokenId);
      changed++;
    } catch (e) {
      errors.push({ task: t.key ?? t.id, code: e instanceof HttpError ? e.code : 'internal' });
    }
  }
  return { data: { matched, changed, errors } };
}
