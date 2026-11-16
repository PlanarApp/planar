import { computed, type MaybeRefOrGetter } from 'vue';
import type { Row } from '@planar/shared';
import { db, mutate, newId } from '../sync';
import { useLive } from './live';

export type LinkSide = 'blocks' | 'blockedBy' | 'relates' | 'duplicates' | 'duplicatedBy';
export type TaskLink = { id: string; side: LinkSide; otherId: string };

export const SIDES: LinkSide[] = ['blocks', 'blockedBy', 'relates', 'duplicates', 'duplicatedBy'];
const INVERSE = { blocks: 'blockedBy', relates: 'relates', duplicates: 'duplicatedBy' } as const;

export const useTaskLinks = (taskId: MaybeRefOrGetter<string>) =>
  useLive(taskId, async (id): Promise<TaskLink[]> => {
    const t = db.table<Row<'taskLinks'>>('taskLinks');
    const [a, b] = await Promise.all([
      t.where('taskId').equals(id).toArray(),
      t.where('targetId').equals(id).toArray(),
    ]);
    return [
      ...a.map((r) => ({ id: r.id, side: r.kind as LinkSide, otherId: r.targetId })),
      ...b.map((r) => ({ id: r.id, side: INVERSE[r.kind] as LinkSide, otherId: r.taskId })),
    ].sort(
      (x, y) =>
        SIDES.indexOf(x.side) - SIDES.indexOf(y.side) ||
        (x.otherId < y.otherId ? -1 : x.otherId > y.otherId ? 1 : 0),
    );
  });

const EMPTY: ReadonlySet<string> = new Set();

/** ids of project tasks blocked by an unfinished task */
export const useBlockedIds = (projectId: MaybeRefOrGetter<string>) => {
  const r = useLive(projectId, async (pid): Promise<ReadonlySet<string>> => {
    // from the links side: links are few, and bulkGet subscribes only to the linked tasks —
    // an edit of any other task (status, title) does not re-run the query
    const rows = (await db.table<Row<'taskLinks'>>('taskLinks').toArray()).filter(
      (l) => l.kind === 'blocks',
    );
    if (!rows.length) return EMPTY;
    const ids = [...new Set(rows.flatMap((l) => [l.taskId, l.targetId]))];
    const byId = new Map(
      (await db.table<Row<'tasks'>>('tasks').bulkGet(ids)).map((x, i) => [ids[i], x]),
    );
    return new Set(
      rows
        .filter((l) => {
          const b = byId.get(l.taskId);
          // an archived blocker no longer blocks (PLNRAPP-155)
          return (
            byId.get(l.targetId)?.projectId === pid && b?.completedAt === null && !b.archivedAt
          );
        })
        .map((l) => l.targetId),
    );
  });
  return computed(() => r.value ?? EMPTY);
};

/** Up to 20 tasks of the space whose title or key contains `q` (links, merge). */
export const useTaskSearch = (
  arg: MaybeRefOrGetter<{ q: string; space: string; skip: ReadonlySet<string> }>,
) =>
  useLive(arg, async ({ q, space, skip }) => {
    if (!q) return [];
    const projects = await db.table<Row<'projects'>>('projects').toArray();
    const out: { id: string; key: string; title: string }[] = [];
    await db
      .table<Row<'tasks'>>('tasks')
      .where('spaceId')
      .equals(space)
      .until(() => out.length >= 20)
      .each((x) => {
        if (skip.has(x.id) || x.archivedAt) return;
        const key = `${projects.find((p) => p.id === x.projectId)?.key ?? '?'}-${x.number ?? '…'}`;
        if (x.title.toLowerCase().includes(q) || key.toLowerCase().includes(q))
          out.push({ id: x.id, key, title: x.title });
      });
    return out;
  });

export async function linkTasks(taskId: string, otherId: string, side: LinkSide): Promise<string> {
  const id = newId();
  const swap = side === 'blockedBy' || side === 'duplicatedBy';
  const kind = side === 'blockedBy' ? 'blocks' : side === 'duplicatedBy' ? 'duplicates' : side;
  await mutate('link.create', {
    id,
    taskId: swap ? otherId : taskId,
    targetId: swap ? taskId : otherId,
    kind,
  });
  return id;
}

export const unlinkTasks = (id: string): Promise<void> => mutate('link.delete', { id });

export { default as BlockedIcon } from './BlockedIcon.vue';
