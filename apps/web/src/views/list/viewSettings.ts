import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { groupTasks, sortTasks, type GroupCtx, type SortBy, type TaskView } from '../../tasks';
import { enabledForProject } from '../../modules/registry';
import { fieldModule, type ViewOptions } from '../options';
import { nextSort } from '../sortHead';
import { visibleColumns } from './columns';

/**
 * PLNRAPP-863: where the "View" menu settings come from — the options object and the callback that
 * changes them. The List of a project passes its view options; another screen — its own.
 */
export interface ViewSettingsSource {
  options: ViewOptions;
  /** change of the settings (sorting by the column header); none — the options object is patched in place */
  update?: (patch: Partial<ViewOptions>) => void;
}

/** "Density" settings of a row: how much a row shows and whether it grows */
export interface ViewDensity {
  wrapTitles: boolean;
  showKey: boolean;
  showLabelNames: boolean;
  showEmpty: boolean;
}

export interface ViewSettingsCtx {
  /** the projects of the tasks: module fields (AI, Git) are shown only where their module is on */
  projectIds: MaybeRefOrGetter<string[]>;
  /** dictionaries for grouping */
  group: MaybeRefOrGetter<GroupCtx>;
  /** the view filter; none — every task passes */
  passes?: MaybeRefOrGetter<(task: TaskView) => boolean>;
}

/**
 * Applies the "View" menu settings to the tasks: filtering of subtasks, grouping (empty groups hidden
 * by the option), sorting inside the groups, visible fields in their order, row density.
 */
export function useViewSettings(
  settings: MaybeRefOrGetter<ViewSettingsSource>,
  tasks: MaybeRefOrGetter<TaskView[] | undefined>,
  ctx: ViewSettingsCtx,
) {
  const options = computed(() => toValue(settings).options);
  // PLNRAPP-401: the AI columns (and Git) only where their module is on
  const fields = computed(() =>
    options.value.fields.filter((f) => {
      const m = fieldModule(f);
      return !m || enabledForProject(m, toValue(ctx.projectIds));
    }),
  );
  const columns = computed(() => visibleColumns(fields.value));
  const groups = computed(() => {
    const o = options.value;
    const passes = toValue(ctx.passes);
    const list = (toValue(tasks) ?? []).filter(
      (x) => (o.showSubtasks || !x.parentId) && (!passes || passes(x)),
    );
    return groupTasks(list, o.groupBy, toValue(ctx.group))
      .filter((g) => o.groupBy === 'none' || !o.hideEmptyGroups || g.tasks.length)
      .map((g) => ({ ...g, tasks: sortTasks(g.tasks, o.sortBy, o.sortDir) }));
  });
  const density = computed<ViewDensity>(() => ({
    wrapTitles: !!options.value.wrapTitles,
    showKey: !!options.value.showKey,
    showLabelNames: !!options.value.showLabelNames,
    showEmpty: !!options.value.showEmpty,
  }));
  // dragging changes the order only in the "Manual" sort
  const manual = computed(() => options.value.sortBy === 'rank' && options.value.sortDir === 'asc');
  function update(patch: Partial<ViewOptions>) {
    const s = toValue(settings);
    if (s.update) s.update(patch);
    else Object.assign(s.options, patch);
  }
  /** sorting by the column header: ascending → descending → manual order */
  const sortBy = (by: SortBy) => update(nextSort(options.value, by));
  return { options, fields, columns, groups, density, manual, update, sortBy };
}
