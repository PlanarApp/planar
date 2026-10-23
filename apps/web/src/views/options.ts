import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import type { GroupBy, SortBy } from '../tasks';

export interface ViewOptions {
  groupBy: GroupBy;
  sortBy: SortBy;
  sortDir: 'asc' | 'desc';
  showSubtasks: boolean;
}

const DEFAULTS: ViewOptions = {
  groupBy: 'status',
  sortBy: 'rank',
  sortDir: 'asc',
  showSubtasks: false,
};

const load = (key: string): ViewOptions => {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // нет хранилища или битый JSON — значения по умолчанию
  }
  return { ...DEFAULTS };
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
