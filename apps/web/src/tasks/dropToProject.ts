import { ref } from 'vue';
import { updateTask } from './ops';

/**
 * PLNRAPP-152: a task dragged from the list or the board onto a sidebar project (`data-drop-project`)
 * moves there, in another space too. The board drags natively (drop event), the list by pointer events.
 */
export const dragged = ref<{ id: string; projectId: string } | null>(null);
/** the project under the pointer while a task is dragged — the sidebar highlights it */
export const overProject = ref<string | null>(null);

export const projectAt = (x: number, y: number): string | null =>
  document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-project]')?.dataset
    .dropProject ?? null;

export function startTaskDrag(task: { id: string; projectId: string }) {
  dragged.value = { id: task.id, projectId: task.projectId };
}

/** end of the drag: true — dropped onto a project (the caller skips its own drop) */
export function endTaskDrag(projectId = overProject.value): boolean {
  const t = dragged.value;
  dragged.value = null;
  overProject.value = null;
  if (!t || !projectId) return false;
  if (projectId !== t.projectId) void updateTask(t.id, { projectId });
  return true;
}
