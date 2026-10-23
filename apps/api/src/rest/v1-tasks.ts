import { asc, inArray } from 'drizzle-orm';
import type { V1Task } from '@planar/shared';
import type { Db } from '../db/index.js';
import * as s from '../db/schema.js';
import { toWire } from '../sync/rows.js';
import type { Q } from '../sync/server-tx.js';

/** строки tasks → V1Task (key, assigneeIds, labelIds); общее для REST и CoreServices.toV1Tasks */
export async function toV1Tasks(db: Db | Q, rows: Record<string, unknown>[]): Promise<V1Task[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id as string);
  const projects = await db
    .select({ id: s.projects.id, key: s.projects.key })
    .from(s.projects)
    .where(inArray(s.projects.id, [...new Set(rows.map((r) => r.projectId as string))]));
  const as = await db
    .select({ t: s.taskAssignees.taskId, u: s.taskAssignees.userId })
    .from(s.taskAssignees)
    .where(inArray(s.taskAssignees.taskId, ids))
    .orderBy(asc(s.taskAssignees.createdAt), asc(s.taskAssignees.id));
  const ls = await db
    .select({ t: s.taskLabels.taskId, l: s.taskLabels.labelId })
    .from(s.taskLabels)
    .where(inArray(s.taskLabels.taskId, ids))
    .orderBy(asc(s.taskLabels.createdAt), asc(s.taskLabels.id));
  const key = new Map(projects.map((p) => [p.id, p.key]));
  return rows.map((r) => {
    const n = r.number as number | null;
    return {
      ...toWire('tasks', r),
      key: n == null ? null : `${key.get(r.projectId as string)}-${n}`,
      assigneeIds: as.filter((x) => x.t === r.id).map((x) => x.u),
      labelIds: ls.filter((x) => x.t === r.id).map((x) => x.l),
    } as V1Task;
  });
}
