import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import { parseColumns } from './table/columns';
import type { GroupBy, SortBy } from '../tasks';
import type { MeMode } from './saved/useFilter';

/** PLNRAPP-401: the List columns of the ai module (status, cost, time of the runs) — only in projects with it */
export const AI_FIELDS = ['ai', 'aiCost', 'aiTime'] as const;
export type TaskField =
  | 'status'
  | 'assignee'
  | 'priority'
  | 'dueDate'
  | 'labels'
  | 'project'
  /** branches / MR / CI of the gitlab module — only in projects with it */
  | 'git'
  | (typeof AI_FIELDS)[number];
export const isAiField = (f: string): f is (typeof AI_FIELDS)[number] =>
  (AI_FIELDS as readonly string[]).includes(f);
export const TASK_FIELDS: TaskField[] = [
  'status',
  'assignee',
  'priority',
  'dueDate',
  'labels',
  'project',
  'git',
  ...AI_FIELDS,
];
/** module fields: offered and shown only where the module is on; not Table columns */
export const fieldModule = (f: string) => (isAiField(f) ? 'ai' : f === 'git' ? 'gitlab' : null);

/** the settings of the "View" menu; a layout shows only those it applies */
export type ViewSetting =
  | 'groupBy'
  | 'sort'
  | 'subtasks'
  | 'subtasksCollapsed'
  | 'showEmpty'
  | 'hideEmptyGroups'
  | 'wrapTitles'
  | 'showKey'
  | 'showLabelNames'
  | 'fields';
const CARDS: ViewSetting[] = [
  'showEmpty',
  'hideEmptyGroups',
  'wrapTitles',
  'showKey',
  'showLabelNames',
];
/** «day» — the «My day» List (its blocks instead of grouping and sorting); a layout not here (module views) — none */
export const LAYOUT_SETTINGS: Record<string, readonly ViewSetting[]> = {
  list: ['groupBy', 'sort', 'subtasks', 'subtasksCollapsed', ...CARDS, 'fields'],
  day: ['subtasks', 'subtasksCollapsed', ...CARDS, 'fields'],
  board: ['groupBy', 'sort', 'subtasks', ...CARDS, 'fields'],
  table: ['sort', 'subtasks', 'subtasksCollapsed', 'wrapTitles', 'fields'],
  calendar: ['subtasks'],
};
/** fields with no place on a Board card */
export const NOT_ON_BOARD: readonly TaskField[] = ['aiCost', 'aiTime'];

export interface ViewOptions {
  groupBy: GroupBy;
  sortBy: SortBy;
  sortDir: 'asc' | 'desc';
  showSubtasks: boolean;
  /** List, Table: subtasks start collapsed (per-parent folding is the exception) */
  subtasksCollapsed?: boolean;
  /** Board: show empty card fields (click — set a value), as in ClickUp */
  showEmpty?: boolean;
  /** List, Board: hide groups (columns) without tasks */
  hideEmptyGroups?: boolean;
  /** List: wrap long task names by words instead of cutting them */
  wrapTitles?: boolean;
  /** List, Board: the task key before the name (the Table has its own "Key" column) */
  showKey?: boolean;
  /** List on mobile: tag names instead of tag icons */
  showLabelNames?: boolean;
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
  subtasksCollapsed: false,
  showEmpty: true,
  hideEmptyGroups: true,
  wrapTitles: true,
  showKey: true,
  showLabelNames: false,
  me: null,
  fields: ['status', 'assignee', 'priority', 'dueDate', 'labels', 'git', 'ai'],
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
