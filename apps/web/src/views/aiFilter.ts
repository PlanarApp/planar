import { computed, type Ref } from 'vue';
import { activityOf, useProjectActivity } from '../modules/activity';

/** PLNRAPP-401: the «AI status» filter values; none — the task has no runs. */
export const AI_STATES = ['none', 'queued', 'running', 'waiting_human', 'failed', 'done'] as const;
export type AiState = (typeof AI_STATES)[number];

/** Client-side «AI status» filter by the project's shared activity (one project; a group view has none). */
export function useAiFilter(
  projectId: () => string | undefined,
  status: () => string | null | undefined,
): Ref<(t: { id: string }) => boolean> {
  const all = useProjectActivity(() => projectId() ?? '');
  return computed(() => {
    const s = status();
    if (!s || !projectId()) return () => true;
    const by = new Map<string | null, string>();
    for (const id of new Set(all.value.map((a) => a.itemId)))
      by.set(id, activityOf(all.value, id)!.state);
    return (t: { id: string }) => (by.get(t.id) ?? 'none') === s;
  });
}
