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
    const tasks = db.table<Row<'tasks'>>('tasks');
    const mine = new Map(
      (await tasks.where('projectId').equals(pid).toArray()).map((x) => [x.id, x]),
    );
    const rows = (
      await db
        .table<Row<'taskLinks'>>('taskLinks')
        .where('targetId')
        .anyOf([...mine.keys()])
        .toArray()
    ).filter((l) => l.kind === 'blocks');
    const blockers = new Map(
      (await tasks.bulkGet([...new Set(rows.map((l) => l.taskId))])).map((x) => [x?.id, x]),
    );
    return new Set(
      rows.filter((l) => blockers.get(l.taskId)?.completedAt === null).map((l) => l.targetId),
    );
  });
  return computed(() => r.value ?? EMPTY);
};

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
