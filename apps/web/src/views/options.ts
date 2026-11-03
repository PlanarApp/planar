import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import { parseColumns } from './table/columns';
import type { GroupBy, SortBy } from '../tasks';
import type { MeMode } from './saved/useFilter';

export type TaskField = 'status' | 'assignee' | 'priority' | 'dueDate' | 'labels' | 'project';
export const TASK_FIELDS: TaskField[] = [
  'status',
  'assignee',
  'priority',
  'dueDate',
  'labels',
  'project',
];

export interface ViewOptions {
  groupBy: GroupBy;
  sortBy: SortBy;
  sortDir: 'asc' | 'desc';
  showSubtasks: boolean;
  /** Board: show empty card fields (click — set a value), as in ClickUp */
  showEmpty?: boolean;
  /** Me Mode: only my tasks (assigned, created, watched); null — all */
  me?: MeMode | null;
  fields: TaskField[];
  /** Table layout: order, width; no id — column hidden */
  columns?: { id: string; width: number }[];
}

export const DEFAULT_OPTIONS: ViewOptions = {
  groupBy: 'status',
  sortBy: 'rank',
  sortDir: 'asc',
  showSubtasks: false,
  showEmpty: false,
  me: null,
  fields: ['status', 'assignee', 'priority', 'dueDate', 'labels'],
};

/** Options from the saved `config`: known fields over the defaults. Not a project (space, folder, "My work") — "Project" is on by default. */
export const optionsFrom = (
  config: Record<string, unknown> | undefined,
  notProject = false,
): ViewOptions => {
  const defaults: ViewOptions = notProject
    ? { ...DEFAULT_OPTIONS, fields: [...DEFAULT_OPTIONS.fields, 'project'] }
    : DEFAULT_OPTIONS;
  const o = {
    ...defaults,
    ...Object.fromEntries(Object.entries(config ?? {}).filter(([k]) => k in DEFAULT_OPTIONS)),
  };
  const fields = Array.isArray(o.fields)
    ? o.fields.filter((f): f is TaskField => TASK_FIELDS.includes(f as TaskField))
    : defaults.fields;
  const columns = parseColumns(config?.columns);
  return { ...o, fields: [...fields], ...(columns && { columns }) };
};

const load = (key: string): ViewOptions => {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return optionsFrom(JSON.parse(raw));
  } catch {
    // no storage or broken JSON — default values
  }
  return optionsFrom(undefined);
};

export function useViewOptions(
  projectId: MaybeRefOrGetter<string>,
  view: MaybeRefOrGetter<string>,
): Ref<ViewOptions> {
  const key = () => `planar.view.${toValue(projectId)}.${toValue(view)}`;
  const options = ref<ViewOptions>(load(key()));
  let loadedKey = key();
  watch(key, (k) => {
    loadedKey = k;
    options.value = load(k);
  });
  watch(
    options,
    (v) => {
      // on a key change we keep only the edits, not the loaded value
      if (loadedKey !== key()) return;
      try {
        localStorage.setItem(loadedKey, JSON.stringify(v));
      } catch {
        // quota or private mode — settings live until reload
      }
    },
    { deep: true, flush: 'sync' },
  );
  return options;
}
