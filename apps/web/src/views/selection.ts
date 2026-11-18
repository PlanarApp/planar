import { computed, onBeforeUnmount, onMounted, readonly, ref } from 'vue';

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

/** Bulk assignee mode (PLNRAPP-498): add to the current, remove from them, or set exactly the picked. */
export type AssignMode = 'add' | 'remove' | 'set';

/** One task's assignees after applying `picked` in `mode`; `set` with nothing picked clears all. */
export const applyAssignees = (
  mode: AssignMode,
  current: readonly string[],
  picked: readonly string[],
): string[] =>
  mode === 'remove'
    ? current.filter((id) => !picked.includes(id))
    : mode === 'set'
      ? [...picked]
      : [...current, ...picked.filter((id) => !current.includes(id))];

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
