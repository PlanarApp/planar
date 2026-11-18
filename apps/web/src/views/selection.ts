import { computed, onBeforeUnmount, onMounted, readonly, ref } from 'vue';

/** A value's state across the selected tasks (PLNRAPP-498): on every task, on some of them, on none. */
export type Tri = 'all' | 'some' | 'none';

/** Ids present in every list (the picker's "checked for all" state). */
export const commonIds = (lists: readonly (readonly string[])[]): string[] =>
  lists.length ? lists[0]!.filter((id) => lists.every((l) => l.includes(id))) : [];

/** State of each id found in the lists; an id missing from the map is on none. */
export const triStates = (lists: readonly (readonly string[])[]): Map<string, Tri> => {
  const m = new Map<string, Tri>();
  for (const id of new Set(lists.flat()))
    m.set(id, lists.every((l) => l.includes(id)) ? 'all' : 'some');
  return m;
};

/** Next state on a click: from "some" — some → all → none → some ("some" = leave as is); otherwise all ↔ none. */
export const nextTri = (initial: Tri, current: Tri): Tri =>
  initial === 'some'
    ? current === 'some'
      ? 'all'
      : current === 'all'
        ? 'none'
        : 'some'
    : current === 'all'
      ? 'none'
      : 'all';

/** Only the changed rows: "all" adds to every task, "none" removes from every task, "some" changes nothing. */
export const triDiff = (
  initial: ReadonlyMap<string, Tri>,
  current: ReadonlyMap<string, Tri>,
): { add: string[]; remove: string[] } => {
  const add: string[] = [];
  const remove: string[] = [];
  for (const id of new Set([...initial.keys(), ...current.keys()])) {
    const from = initial.get(id) ?? 'none';
    const to = current.get(id) ?? 'none';
    if (to === from) continue;
    if (to === 'all') add.push(id);
    else if (to === 'none') remove.push(id);
  }
  return { add, remove };
};

/** One task's ids after the diff. */
export const applyDiff = (
  current: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): string[] => [
  ...current.filter((id) => !remove.includes(id)),
  ...add.filter((id) => !current.includes(id)),
];
// one state for the app
const selected = ref<ReadonlySet<string>>(new Set());
const anchor = ref<string | null>(null);
// selection mode (PLNRAPP-291): on while something is selected — checkboxes and the bulk bar show only then
const active = computed(() => selected.value.size > 0);

export function useSelection() {
  return {
    selected: readonly(selected),
    anchor: readonly(anchor),
    active,
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

/** A click target that is not "empty space": a task, a control or a menu. */
const BUSY =
  '[data-task], button, input, select, textarea, label, a, [role=toolbar], [role=menu], [contenteditable=true]';

/**
 * Leaving the selection mode (PLNRAPP-291) in a view: Escape anywhere outside fields and open
 * dialogs/menus, a click on an empty place of the view's area.
 */
export function useSelectionReset(area: () => HTMLElement | null | undefined) {
  const sel = useSelection();
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented || !sel.active.value) return;
    const t = e.target as HTMLElement | null;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (document.querySelector('[role=dialog], [role=menu]')) return;
    sel.clear();
  }
  function onClick(e: MouseEvent) {
    if (!sel.active.value || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const t = e.target as Element | null;
    const el = area();
    if (!t || !el?.contains(t) || t.closest(BUSY)) return;
    sel.clear();
  }
  onMounted(() => {
    window.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onClick);
  });
}
