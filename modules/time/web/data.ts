// The module's single point of contact with the web core: replica, mutations, user, language.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  db,
  i18n,
  mutate,
  newId,
  openTask,
  useQuery,
  useSession,
  useWeekStart,
} from '@planar/web/modules';
import type { TimeEntry, TimeEstimate } from '../shared/index.js';
import type { TaskNode } from './lib.js';

export { mutate, newId, openTask, useWeekStart };
export type TaskLite = TaskNode & { title: string; projectId?: string; spaceId?: string };

export const userId = () => useSession().value?.id ?? '';

/** Own entries (including the running one). */
export const useEntries = (uid: () => string) =>
  useQuery(
    () => db.table('timeEntries').where('userId').equals(uid()).toArray() as Promise<TimeEntry[]>,
  );
export const useMyEntries = () => useEntries(userId);
/** the owner or the instance admin: the "Time" of any user (spaces' entries are in the replica anyway) */
export const isInstanceAdmin = () => ['owner', 'admin'].includes(useSession().value?.role ?? '');
export const useUsers = () =>
  useQuery(async () =>
    (
      (await db.table('users').toArray()) as {
        id: string;
        name: string;
        deactivatedAt: string | null;
      }[]
    )
      .filter((u) => !u.deactivatedAt)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
export const useEstimate = (taskId: () => string) =>
  useQuery(() => db.table('timeEstimates').get(taskId()) as Promise<TimeEstimate | undefined>);
export const useTasks = () =>
  useQuery(async () =>
    (await db.table('tasks').toArray()).map((t): TaskLite => ({
      id: t.id,
      parentId: t.parentId ?? null,
      title: t.title,
      projectId: t.projectId,
      spaceId: t.spaceId,
    })),
  );

/** The current time, ticks once a second while the component is mounted. */
export function useNow() {
  const now = ref(Date.now());
  let h: ReturnType<typeof setInterval> | undefined;
  onMounted(() => (h = setInterval(() => (now.value = Date.now()), 1000)));
  onBeforeUnmount(() => clearInterval(h));
  return now;
}

const dict = {
  start: { ru: 'Старт', en: 'Start' },
  stop: { ru: 'Стоп', en: 'Stop' },
  spent: { ru: 'Потрачено', en: 'Spent' },
  withSub: { ru: 'с подзадачами', en: 'incl. subtasks' },
  estimate: { ru: 'Оценка', en: 'Estimate' },
  estimateHint: { ru: 'ч:мм', en: 'h:mm' },
  entries: { ru: 'Мои записи', en: 'My entries' },
  noEntries: { ru: 'Записей нет', en: 'No entries' },
  addManual: { ru: 'Добавить время', en: 'Add time' },
  add: { ru: 'Добавить', en: 'Add' },
  note: { ru: 'Заметка', en: 'Note' },
  del: { ru: 'Удалить', en: 'Delete' },
  confirmDel: { ru: 'Удалить запись?', en: 'Delete entry?' },
  more: { ru: 'Действия', en: 'Actions' },
  day: { ru: 'Дата', en: 'Date' },
  invalid: { ru: 'Неверное время', en: 'Invalid time' },
  timer: { ru: 'Таймер', en: 'Timer' },
  week: { ru: 'Время', en: 'Time' },
  user: { ru: 'Пользователь', en: 'User' },
  prev: { ru: 'Прошлая неделя', en: 'Previous week' },
  next: { ru: 'Следующая неделя', en: 'Next week' },
  task: { ru: 'Задача', en: 'Task' },
  total: { ru: 'Итого', en: 'Total' },
  empty: { ru: 'На этой неделе записей нет', en: 'No entries this week' },
} as const;
export type Key = keyof typeof dict;
export const tr = (k: Key): string => {
  const l = i18n.global.locale.value as 'ru' | 'en';
  return dict[k][l] ?? dict[k].ru;
};
export const locale = () => i18n.global.locale.value;
