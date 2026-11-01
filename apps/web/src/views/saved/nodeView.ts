import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue';
import type { Filter } from '../filter';
import { optionsFrom, type ViewOptions } from '../options';
import { saveView, updateView } from './ops';
import { useNodeView } from './queries';

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));
// a filter without rules is the same as no filter
const norm = (f: Filter | null | undefined): Filter | null => (f?.rules?.length ? f : null);

/**
 * Built-in tab view of a node, as in ClickUp: edits of options and filter are a draft;
 * "Save" writes my node view to the server, "Reset" returns the saved one (or the default).
 * fixed — options set from outside (Me Mode of "My work"), they are not an edit.
 */
export function useNodeViewDraft(a: {
  spaceId: MaybeRefOrGetter<string>;
  node: MaybeRefOrGetter<string>;
  layout: MaybeRefOrGetter<string>;
  fixed?: MaybeRefOrGetter<Partial<ViewOptions>>;
}) {
  const row = useNodeView(a.node, a.layout);
  const base = () => ({
    options: { ...optionsFrom(row.value?.config), ...toValue(a.fixed) },
    filter: norm(row.value?.filter as Filter | undefined),
  });
  const options = ref<ViewOptions>(base().options);
  const filter = ref<Filter | null>(null);
  const reset = () => {
    const b = plain(base());
    options.value = b.options;
    filter.value = b.filter;
  };
  // another node or tab, the saved row arrived or changed — start from it
  watch(
    [
      () => toValue(a.node),
      () => toValue(a.layout),
      () => row.value?.id,
      () => row.value?.updatedAt,
    ],
    reset,
    { immediate: true },
  );
  const dirty = computed(() => {
    const b = base();
    return (
      JSON.stringify(b.options) !== JSON.stringify(options.value) ||
      JSON.stringify(b.filter) !== JSON.stringify(norm(filter.value))
    );
  });
  async function save() {
    const f = norm(filter.value);
    const r = row.value;
    if (r) await updateView(r.id, { config: options.value, filter: f ?? { op: 'and', rules: [] } });
    else
      await saveView({
        spaceId: toValue(a.spaceId),
        personal: true,
        name: toValue(a.layout),
        layout: toValue(a.layout),
        node: toValue(a.node),
        filter: f,
        config: options.value,
      });
  }
  return { options, filter, dirty, save, reset };
}
