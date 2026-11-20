import { computed, type Ref } from 'vue';
import { AI_STATES } from '@planar/shared';
import { activityOf, useProjectActivity } from '../modules/activity';
import type { Filter, FilterRule } from './filter';

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

/**
 * PLNRAPP-664: the view filter with the old panel «AI status» selector (`config.aiStatus` of a saved view, a tab row)
 * moved into an `aiStatus in [value]` rule — the same tasks through the general filter. The panel filter was
 * applied on top of the view filter (AND): with «all rules» (or a single condition) the rule is added to «all
 * rules»; with «any rule» and several conditions the old filter becomes a nested group: «AI status AND (A OR B)».
 * No (or an unknown) old value — the filter as is; a migrated filter is not changed again.
 */
export function migrateAiStatus(
  config: Record<string, unknown> | null | undefined,
  filter: Filter | null,
): Filter | null {
  const s = config?.aiStatus;
  if (typeof s !== 'string' || !(AI_STATES as readonly string[]).includes(s)) return filter;
  const rule: FilterRule = { field: 'aiStatus', operator: 'in', value: [s] };
  const rules = filter?.rules ?? [];
  const groups = filter?.groups ?? [];
  if (filter && filter.op === 'or' && rules.length + groups.length > 1)
    return { op: 'and', rules: [rule], groups: [filter] };
  const has = rules.some(
    (r) =>
      r.field === 'aiStatus' &&
      r.operator === 'in' &&
      Array.isArray(r.value) &&
      r.value.length === 1 &&
      r.value[0] === s,
  );
  // here «all rules» or a single condition: «any» of one is «all» of one
  if (has) return filter!.op === 'and' ? filter : { ...filter!, op: 'and' };
  return { op: 'and', rules: [...rules, rule], ...(groups.length && { groups }) };
}
