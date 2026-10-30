import { readonly, ref } from 'vue';

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
    clear() {
      selected.value = new Set();
      anchor.value = null;
    },
  };
}
