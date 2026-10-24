// Единственная точка контакта модуля с ядром web.
import {
  db,
  i18n,
  mutate,
  newId,
  useQuery,
  useSession,
  useSpaces,
  useWeekStart,
  openTask,
} from '@planar/web/modules';
import type { WorkloadCapacity } from '../shared/index.js';

export { mutate, newId, useWeekStart, useSpaces, openTask };
export const userId = () => useSession().value?.id ?? '';

interface Base {
  id: string;
}
const all = <T>(t: string, spaceId: string) =>
  db.table(t).where('spaceId').equals(spaceId).toArray() as Promise<T[]>;

/** Данные пространства для таблицы; `time` — включён ли модуль time (есть оценки). */
export const useWorkloadData = (spaceId: () => string) =>
  useQuery(async () => {
    const s = spaceId();
    if (!s) return null;
    const has = (n: string) => db.tables.some((t) => t.name === n);
    const [tasks, assignees, statuses, members, caps, projects, estimates, users] =
      await Promise.all([
        all<{
          id: string;
          statusId: string;
          dueDate: string | null;
          startDate: string | null;
          title: string;
          number: number | null;
          projectId: string;
        }>('tasks', s),
        all<{ taskId: string; userId: string }>('taskAssignees', s),
        all<Base & { category: string }>('statuses', s),
        all<{ userId: string; role: string }>('spaceMembers', s),
        has('workloadCapacities') ? all<WorkloadCapacity>('workloadCapacities', s) : [],
        all<Base & { key: string }>('projects', s),
        has('timeEstimates') ? all<{ taskId: string; minutes: number }>('timeEstimates', s) : null,
        db.table('users').toArray() as Promise<{ id: string; name: string }[]>,
      ]);
    return { tasks, assignees, statuses, members, caps, projects, estimates, users };
  });

export const useMe = () => {
  const s = useSession();
  return () => s.value;
};

const dict = {
  title: { ru: 'Загрузка', en: 'Workload' },
  space: { ru: 'Пространство', en: 'Space' },
  mode: { ru: 'Режим', en: 'Mode' },
  estimates: { ru: 'Оценки, ч', en: 'Estimates, h' },
  count: { ru: 'Число задач', en: 'Task count' },
  prev: { ru: 'Раньше', en: 'Earlier' },
  next: { ru: 'Позже', en: 'Later' },
  person: { ru: 'Участник', en: 'Member' },
  capacity: { ru: 'Ёмкость, ч/нед', en: 'Capacity, h/wk' },
  overload: { ru: 'Перегрузка', en: 'Overloaded' },
  tasks: { ru: 'Задачи ячейки', en: 'Cell tasks' },
  empty: { ru: 'Нет пространств', en: 'No spaces' },
  close: { ru: 'Закрыть', en: 'Close' },
} as const;
export type Key = keyof typeof dict;
export const tr = (k: Key): string =>
  dict[k][i18n.global.locale.value as 'ru' | 'en'] ?? dict[k].ru;
