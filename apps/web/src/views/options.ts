import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import type { GroupBy, SortBy } from '../tasks';

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
  fields: TaskField[];
}

export const DEFAULT_OPTIONS: ViewOptions = {
  groupBy: 'status',
  sortBy: 'rank',
  sortDir: 'asc',
  showSubtasks: false,
  fields: ['status', 'assignee', 'priority', 'dueDate', 'labels'],
};

/** Опции из сохранённого `config`: известные поля поверх умолчаний. */
export const optionsFrom = (config: Record<string, unknown> | undefined): ViewOptions => {
  const o = {
    ...DEFAULT_OPTIONS,
    ...Object.fromEntries(Object.entries(config ?? {}).filter(([k]) => k in DEFAULT_OPTIONS)),
  };
  const fields = Array.isArray(o.fields)
    ? o.fields.filter((f): f is TaskField => TASK_FIELDS.includes(f as TaskField))
    : DEFAULT_OPTIONS.fields;
  return { ...o, fields: [...fields] };
};

const load = (key: string): ViewOptions => {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return optionsFrom(JSON.parse(raw));
  } catch {
    // нет хранилища или битый JSON — значения по умолчанию
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
      // при смене ключа сохраняем только правки, а не загруженное значение
      if (loadedKey !== key()) return;
      try {
        localStorage.setItem(loadedKey, JSON.stringify(v));
      } catch {
        // квота или приватный режим — настройки живут до перезагрузки
      }
    },
    { deep: true, flush: 'sync' },
  );
  return options;
}
