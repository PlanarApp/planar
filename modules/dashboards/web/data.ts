// The module's single point of contact with the web core: replica, mutations, user, language.
import { computed } from 'vue';
import type { FilterCtx } from '@planar/shared';
import {
  db,
  i18n,
  localToday,
  mutate,
  newId,
  openTask,
  rankBetween,
  useCycles,
  useQuery,
  useSession,
  useSpaces,
  useWeekStart,
} from '@planar/web/modules';
import type { Board, Widget } from '../shared/index.js';
import { choiceNames, groupableFields, type FieldDefLite, type Task } from './lib.js';

export { mutate, newId, openTask, rankBetween, useSpaces, useWeekStart, localToday };

export const userId = () => useSession().value?.id ?? '';

export const useBoards = () =>
  useQuery(async () =>
    ((await db.table('dashboardsBoards').toArray()) as Board[]).sort((a, b) =>
      a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0,
    ),
  );
export const useBoard = (id: () => string) =>
  useQuery(() => db.table('dashboardsBoards').get(id()) as Promise<Board | undefined>);
export const useWidgets = (boardId: () => string) =>
  useQuery(
    () =>
      db.table('dashboardsWidgets').where('dashboardId').equals(boardId()).toArray() as Promise<
        Widget[]
      >,
  );

/** All visible tasks with assignees and labels (as FilterTask). */
export const useTasks = () =>
  useQuery(async (): Promise<Task[]> => {
    const [tasks, as, ls] = await Promise.all([
      db.table('tasks').toArray(),
      db.table('taskAssignees').toArray(),
      db.table('taskLabels').toArray(),
    ]);
    const group = (rows: { taskId: string }[], f: (r: never) => string) => {
      const m = new Map<string, string[]>();
      for (const r of rows) m.set(r.taskId, [...(m.get(r.taskId) ?? []), f(r as never)]);
      return m;
    };
    const am = group(as, (r: { userId: string }) => r.userId);
    const lm = group(ls, (r: { labelId: string }) => r.labelId);
    return tasks.map((t) => ({
      ...t,
      assigneeIds: am.get(t.id) ?? [],
      labelIds: lm.get(t.id) ?? [],
    }));
  });

/** Space fields for grouping (select/user). */
export const useGroupFields = (spaceId: () => string) =>
  useQuery(async () =>
    groupableFields(
      (await db.table('fieldDefs').where('spaceId').equals(spaceId()).toArray()) as FieldDefLite[],
    ),
  );

/** id -> name (statuses, labels, users, projects, spaces) for column captions. */
export const useNames = () => {
  const r = useQuery(async () => {
    const m: Record<string, string> = {};
    for (const [t, f] of [
      ['statuses', 'name'],
      ['labels', 'name'],
      ['users', 'name'],
      ['projects', 'name'],
      ['spaces', 'name'],
      ['fieldDefs', 'name'],
    ] as const)
      for (const x of await db.table(t).toArray()) m[x.id] = x[f];
    Object.assign(m, choiceNames((await db.table('fieldDefs').toArray()) as FieldDefLite[]));
    return m;
  });
  return computed(() => r.value ?? {});
};

/** matchFilter context (F-filter v2); undefined while the references are loading. */
export function useFilterCtx() {
  const r = useQuery(async () => ({
    statuses: await db.table('statuses').toArray(),
    fieldDefs: await db.table('fieldDefs').toArray(),
  }));
  const cycles = useCycles();
  return computed(
    (): FilterCtx | undefined =>
      r.value && {
        statuses: r.value.statuses,
        fieldDefs: r.value.fieldDefs,
        cycles: cycles.value,
        userId: userId(),
        today: localToday(),
      },
  );
}

const dict = {
  title: { ru: 'Дашборды', en: 'Dashboards' },
  personal: { ru: 'Личные', en: 'Personal' },
  none: { ru: 'Дашбордов нет', en: 'No dashboards' },
  create: { ru: 'Новый дашборд', en: 'New dashboard' },
  template: { ru: 'Шаблон', en: 'Template' },
  blank: { ru: 'Пустой', en: 'Blank' },
  name: { ru: 'Название', en: 'Name' },
  space: { ru: 'Где', en: 'Where' },
  rename: { ru: 'Переименовать', en: 'Rename' },
  save: { ru: 'Сохранить', en: 'Save' },
  cancel: { ru: 'Отмена', en: 'Cancel' },
  del: { ru: 'Удалить', en: 'Delete' },
  delBoard: { ru: 'Удалить дашборд?', en: 'Delete dashboard?' },
  addWidget: { ru: 'Добавить виджет', en: 'Add widget' },
  editWidget: { ru: 'Виджет', en: 'Widget' },
  kind: { ru: 'Вид', en: 'Kind' },
  number: { ru: 'Число', en: 'Number' },
  bars: { ru: 'Столбцы', en: 'Bars' },
  line: { ru: 'Линия', en: 'Line' },
  list: { ru: 'Список', en: 'List' },
  widgetTitle: { ru: 'Заголовок', en: 'Title' },
  groupBy: { ru: 'Группировать по', en: 'Group by' },
  series: { ru: 'Ряд', en: 'Series' },
  created: { ru: 'Создано', en: 'Created' },
  completed: { ru: 'Закрыто', en: 'Completed' },
  weeks: { ru: 'Недель', en: 'Weeks' },
  sort: { ru: 'Сортировка', en: 'Sort' },
  limit: { ru: 'Сколько', en: 'Limit' },
  status: { ru: 'Статус', en: 'Status' },
  priority: { ru: 'Приоритет', en: 'Priority' },
  assignee: { ru: 'Исполнитель', en: 'Assignee' },
  label: { ru: 'Метка', en: 'Label' },
  project: { ru: 'Проект', en: 'Project' },
  updatedAt: { ru: 'Обновлено', en: 'Updated' },
  dueDate: { ru: 'Срок', en: 'Due date' },
  noValue: { ru: 'Не задано', en: 'Not set' },
  empty: { ru: 'Нет данных', en: 'No data' },
  loading: { ru: 'Загрузка…', en: 'Loading…' },
  move: { ru: 'Переместить', en: 'Move' },
  resize: { ru: 'Изменить размер', en: 'Resize' },
  back: { ru: 'К списку', en: 'Back to list' },
  notFound: { ru: 'Дашборд не найден', en: 'Dashboard not found' },
} as const;
export type Key = keyof typeof dict;
export const tr = (k: Key): string => {
  const l = i18n.global.locale.value as 'ru' | 'en';
  return dict[k][l] ?? dict[k].ru;
};
export const locale = () => i18n.global.locale.value;
