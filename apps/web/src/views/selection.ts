import { readonly, ref } from 'vue';

/** Ids present in every list (the picker's "checked for all" state). */
export const commonIds = (lists: readonly (readonly string[])[]): string[] =>
  lists.length ? lists[0]!.filter((id) => lists.every((l) => l.includes(id))) : [];

/** Applies the picker's change `from → to` to one task's ids: adds the newly checked, removes the unchecked. */
export const applyToggle = (
  current: readonly string[],
  from: readonly string[],
  to: readonly string[],
): string[] => [
  ...current.filter((id) => !from.includes(id) || to.includes(id)),
  ...to.filter((id) => !from.includes(id) && !current.includes(id)),
];

// one state for the app
const selected = ref<ReadonlySet<string>>(new Set());
const anchor = ref<string | null>(null);

export function useSelection() {
  return {
    selected: readonly(selected),
    anchor: readonly(anchor),
    set(ids: string[]) {
      selected.value = new Set(ids);
      anchor.value = ids.at(-1) ?? null;
    },
    toggle(id: string) {
      const s = new Set(selected.value);
      if (!s.delete(id)) s.add(id);
      selected.value = s;
      anchor.value = id;
    },
    range(ids: string[], toId: string) {
      const to = ids.indexOf(toId);
      if (to < 0) return;
      const from = Math.max(anchor.value === null ? to : ids.indexOf(anchor.value), 0);
      const [a, b] = from < to ? [from, to] : [to, from];
      selected.value = new Set(ids.slice(a, b + 1));
      anchor.value ??= toId;
    },
    /** none / some / all of `ids` are selected (the "select all" checkbox state). */
    state(ids: readonly string[]): 'none' | 'some' | 'all' {
      const n = ids.filter((id) => selected.value.has(id)).length;
      return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
    },
    /** All of `ids` selected: unselect them; otherwise add them to the selection. */
    toggleAll(ids: readonly string[]) {
      const s = new Set(selected.value);
      const all = ids.length > 0 && ids.every((id) => s.has(id));
      for (const id of ids) {
        if (all) s.delete(id);
        else s.add(id);
      }
      selected.value = s;
    },
    clear() {
      selected.value = new Set();
      anchor.value = null;
    },
  };
}
