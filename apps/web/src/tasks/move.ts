import { shallowRef } from 'vue';
import type { Row } from '@planar/shared';
import { mutate } from '../sync';

/** PLNRAPP-519: a task picked in the "Move to project" menu — MoveTaskDialog asks for the status and subtasks. */
export const moveTarget = shallowRef<{
  task: { id: string; key: string; statusId: string };
  spaceId: string;
  projectId: string;
  /** "Space / Project" of the target */
  label: string;
} | null>(null);

/** Status of the target project offered for a moved task — the mutator's rule: same name, else same category, else the first. */
export function defaultStatus(
  old: Pick<Row<'statuses'>, 'name' | 'category'> | undefined,
  list: Row<'statuses'>[],
): Row<'statuses'> | undefined {
  const sorted = [...list].sort((x, y) => (x.rank < y.rank ? -1 : x.rank > y.rank ? 1 : 0));
  const name = old?.name.toLowerCase();
  return (
    sorted.find((s) => s.name.toLowerCase() === name) ??
    sorted.find((s) => s.category === old?.category) ??
    sorted[0]
  );
}

export const moveTask = (
  id: string,
  to: { projectId: string; statusId: string; withSubtasks: boolean },
): Promise<void> => mutate('task.update', { id, ...to });
