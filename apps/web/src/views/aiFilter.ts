import { computed, type Ref } from 'vue';
import { AI_STATES } from '@planar/shared';
import { activityOf, useProjectActivity } from '../modules/activity';
import type { Filter } from './filter';

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

const oldValue = (config: Record<string, unknown> | null | undefined): string | null => {
  const s = config?.aiStatus;
  return typeof s === 'string' && (AI_STATES as readonly string[]).includes(s) ? s : null;
};
/** «any rule» with several rules: `F AND aiStatus` is not a flat filter (no nested groups). */
const nests = (filter: Filter | null) => filter?.op === 'or' && filter.rules.length > 1;

/**
 * PLNRAPP-664: the view filter with the old panel «AI status» selector (`config.aiStatus` of a saved view, a tab row)
 * moved into an `aiStatus in [value]` rule — the same tasks through the general filter. The panel filter was
 * applied on top of the view filter (AND): with «all rules» (or no rules) the rule is added; with «any rule» and a
 * single rule the filter becomes «all rules». With «any rule» and several rules the filter can not take it (no
 * nested groups) — the filter as is, the old value stays (`legacyAiStatus`). No (or an unknown) old value — as is.
 */
export function migrateAiStatus(
  config: Record<string, unknown> | null | undefined,
  filter: Filter | null,
): Filter | null {
  const s = oldValue(config);
  if (!s || nests(filter)) return filter;
  const rules = filter?.rules ?? [];
  const has = rules.some(
    (r) =>
      r.field === 'aiStatus' &&
      r.operator === 'in' &&
      Array.isArray(r.value) &&
      r.value.length === 1 &&
      r.value[0] === s,
  );
  if (has) return filter;
  return { op: 'and', rules: [...rules, { field: 'aiStatus', operator: 'in', value: [s] }] };
}

/**
 * PLNRAPP-664: the old panel value the view filter can not take (see `migrateAiStatus`) — it keeps filtering the
 * view as before (`useAiFilter`, AND on top of the filter) and is shown on the panel as a removable note;
 * null — nothing left. `filter` — the view filter before the migration.
 */
export function legacyAiStatus(
  config: Record<string, unknown> | null | undefined,
  filter: Filter | null,
): string | null {
  return nests(filter) ? oldValue(config) : null;
}

/** Client-side old panel «AI status» filter by the project's shared activity (one project; a group view has none). */
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
