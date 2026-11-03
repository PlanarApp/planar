import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue';
import { newId } from '../../sync';
import type { Filter } from '../filter';
import { optionsFrom, type ViewOptions } from '../options';
import { deleteView, saveView, setNodeDefault, updateView } from './ops';
import { useNodeViewRows } from './queries';

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));
// a filter without rules is the same as no filter
const norm = (f: Filter | null | undefined): Filter | null => (f?.rules?.length ? f : null);
const DEBOUNCE_MS = 400; // the contract: ≤ 500

/**
 * Built-in tab view of a node (C-mutators v12): every edit of options and filter is saved to my
 * personal row on the server after a short debounce (no draft); `saveForAll` makes the current
 * state the shared default, `reset` drops my row — the shared (or built-in) default returns.
 * fixed — options set from outside (Me Mode of "My work"), they are not an edit.
 */
export function useNodeViewDraft(a: {
  spaceId: MaybeRefOrGetter<string>;
  node: MaybeRefOrGetter<string>;
  layout: MaybeRefOrGetter<string>;
  fixed?: MaybeRefOrGetter<Partial<ViewOptions>>;
  /** the node is not a project (summary): the "Project" field is on by default */
  notProject?: boolean;
}) {
  const rows = useNodeViewRows(a.node, a.layout);
  const row = computed(() => (rows.value ? (rows.value.personal ?? rows.value.shared) : undefined));
  const base = () => ({
    options: { ...optionsFrom(row.value?.config, a.notProject), ...toValue(a.fixed) },
    filter: norm(row.value?.filter as Filter | undefined),
  });
  const options = ref<ViewOptions>(base().options);
  const filter = ref<Filter | null>(null);
  const state = () => ({ options: options.value, filter: norm(filter.value) });
  const reset = () => {
    const b = plain(base());
    options.value = b.options;
    filter.value = b.filter;
  };

  // a write waiting for the debounce; everything is captured when the edit is made, so that a
  // switch of node or tab before the timer fires still writes to the node that was edited
  type Write = {
    key: string;
    spaceId: string;
    node: string;
    layout: string;
    personalId: string | null;
    options: ViewOptions;
    filter: Filter | null;
  };
  let pending: Write | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  // client id of a row that is unknown yet — stable per node+layout, so a retry does not duplicate
  const newIds = new Map<string, string>();
  const created = new Set<string>();

  const flush = () => {
    clearTimeout(timer);
    const w = pending;
    pending = null;
    if (!w) return;
    queue = queue
      .then(async () => {
        const f = w.filter ?? { op: 'and' as const, rules: [] };
        const id = w.personalId ?? newIds.get(w.key);
        if (id && (w.personalId || created.has(id)))
          return await updateView(id, { config: w.options, filter: f });
        const nid = id ?? newId();
        newIds.set(w.key, nid);
        created.add(nid);
        await saveView({
          id: nid,
          spaceId: w.spaceId,
          personal: true,
          name: w.layout,
          layout: w.layout,
          node: w.node,
          filter: w.filter,
          config: w.options,
        });
      })
      .catch(() => undefined); // offline mutations are queued by sync; a rejected one has nothing to retry
  };
  const keyOf = () => `${toValue(a.node)}|${toValue(a.layout)}`;
  const schedule = () => {
    if (pending && pending.key !== keyOf()) flush();
    if (JSON.stringify(state()) === JSON.stringify(base())) {
      pending = null;
      clearTimeout(timer);
      return;
    }
    pending = {
      key: keyOf(),
      spaceId: toValue(a.spaceId),
      node: toValue(a.node),
      layout: toValue(a.layout),
      personalId: rows.value?.personal?.id ?? null,
      ...plain(state()),
    };
    clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  };
  watch([options, filter], schedule, { deep: true });
  onScopeDispose(flush);

  // another node or tab, the row arrived or changed (another device, share, reset) — start from it;
  // unsent edits of mine win
  watch(
    [() => toValue(a.node), () => toValue(a.layout)],
    () => {
      reset();
    },
    { immediate: true },
  );
  watch(
    () => JSON.stringify(base()),
    () => {
      if (!pending) reset();
    },
  );

  async function saveForAll() {
    flush();
    await queue;
    const s = plain(state());
    await setNodeDefault({
      spaceId: toValue(a.spaceId),
      node: toValue(a.node),
      layout: toValue(a.layout),
      filter: s.filter,
      config: s.options,
    });
    newIds.delete(keyOf());
  }
  async function resetToDefault() {
    pending = null;
    clearTimeout(timer);
    await queue;
    const p = rows.value?.personal;
    newIds.delete(keyOf());
    if (p) await deleteView(p.id);
    reset();
  }
  return {
    options,
    filter,
    /** I have my own row: "Reset" has something to drop */
    hasPersonal: computed(() => !!rows.value?.personal),
    saveForAll,
    reset: resetToDefault,
  };
}
