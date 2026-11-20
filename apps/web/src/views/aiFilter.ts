import { computed, type Ref } from 'vue';
import { activityOf, useProjectActivity } from '../modules/activity';

/** PLNRAPP-401: the «AI status» filter values — shared with the `aiStatus` filter rule (PLNRAPP-663). */
export { AI_STATES, type AiState } from '@planar/shared';

/**
 * PLNRAPP-663: the AI state of the project's tasks with runs (task id → state; others — `none`) by its shared
 * activity; undefined — no project (a group view).
 */
export function useAiStates(
  projectId: () => string | undefined,
): Ref<ReadonlyMap<string, string> | undefined> {
  const all = useProjectActivity(() => projectId() ?? '');
  return computed(() => {
    const pid = projectId();
    if (!pid) return undefined;
    const by = new Map<string, string>();
    for (const id of new Set(all.value.map((a) => a.itemId)))
      if (id) by.set(id, activityOf(all.value, id)!.state);
    return by;
  });
}

/** Client-side «AI status» filter by the project's shared activity (one project; a group view has none). */
export function useAiFilter(
  projectId: () => string | undefined,
  status: () => string | null | undefined,
): Ref<(t: { id: string }) => boolean> {
  const states = useAiStates(projectId);
  return computed(() => {
    const s = status();
    const by = states.value;
    if (!s || !by) return () => true;
    return (t: { id: string }) => (by.get(t.id) ?? 'none') === s;
  });
}
