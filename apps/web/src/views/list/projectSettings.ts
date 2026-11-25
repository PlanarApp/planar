import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue';
import { optionsFrom, type ViewOptions } from '../options';
import { useNodeView } from '../saved/queries';
import type { ViewSettingsSource } from './viewSettings';

/**
 * PLNRAPP-865: the "View" settings of a project's List tab (my row, else the shared default, else the
 * defaults of the List) — read-only for another screen (the "Subtasks" tab of the card). Edits of the
 * List come in live; sorting by a column header here stays local, not saved. fixed — options set by
 * the screen over the project's ones.
 */
export function useProjectListSettings(
  projectId: MaybeRefOrGetter<string>,
  fixed: Partial<ViewOptions> = {},
) {
  const row = useNodeView(() => `p:${toValue(projectId)}`, 'list');
  const local = ref<Partial<ViewOptions>>({});
  watch(
    () => toValue(projectId),
    () => (local.value = {}),
  );
  return computed<ViewSettingsSource>(() => ({
    options: { ...optionsFrom(row.value?.config ?? undefined), ...local.value, ...fixed },
    update: (patch) => (local.value = { ...local.value, ...patch }),
  }));
}
