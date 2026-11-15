import { shallowRef } from 'vue';
import type { Row } from '@planar/shared';
import { db, mutate, newId } from '../sync';

/** The task being merged into another one (PLNRAPP-117): MergeDialog asks for the target. */
export const mergeFrom = shallowRef<{
  id: string;
  key: string;
  title: string;
  spaceId: string;
} | null>(null);

/** Tasks `ids` merge into `targetId` in one mutation (PLNRAPP-117). */
export const mergeTasks = (ids: readonly string[], targetId: string): Promise<void> =>
  mutate('task.merge', { ids: [...ids], targetId, linkIds: ids.map(() => newId()) });

export const mergeTask = (id: string, targetId: string): Promise<void> =>
  mergeTasks([id], targetId);

/** Selected tasks that cannot be the target: descendants (at any depth) of another selected task. */
export async function descendantsOfSelected(
  ids: readonly string[],
  parentOf: (id: string) => Promise<string | null | undefined>,
): Promise<Set<string>> {
  const selected = new Set(ids);
  const out = new Set<string>();
  for (const id of ids) {
    const seen = new Set([id]);
    for (let p = await parentOf(id); p && !seen.has(p); p = await parentOf(p)) {
      if (selected.has(p)) {
        out.add(id);
        break;
      }
      seen.add(p);
    }
  }
  return out;
}

/** Parent of a task from the local replica. */
export const parentInReplica = async (id: string) =>
  (await db.table<Row<'tasks'>>('tasks').get(id))?.parentId;
