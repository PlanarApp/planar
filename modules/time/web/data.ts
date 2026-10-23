// Единственная точка контакта модуля с ядром web: реплика, мутации, пользователь, язык.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { db, i18n, mutate, newId, useQuery, useSession, useWeekStart } from '@planar/web/modules';
import type { TimeEntry, TimeEstimate } from '../shared/index.js';
import type { TaskNode } from './lib.js';

export { mutate, newId, useWeekStart };
export type TaskLite = TaskNode & { title: string };

export const userId = () => useSession().value?.id ?? '';

/** Свои записи (включая идущую). */
export const useMyEntries = () =>
  useQuery(
    () =>
      db.table('timeEntries').where('userId').equals(userId()).toArray() as Promise<TimeEntry[]>,
  );
export const useEstimate = (taskId: () => string) =>
  useQuery(() => db.table('timeEstimates').get(taskId()) as Promise<TimeEstimate | undefined>);
export const useTasks = () =>
  useQuery(async () =>
    (await db.table('tasks').toArray()).map((t): TaskLite => ({
      id: t.id,
      parentId: t.parentId ?? null,
      title: t.title,
    })),
  );

/** Текущее время, тикает раз в секунду, пока компонент смонтирован. */
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
  invalid: { ru: 'Неверное время', en: 'Invalid time' },
  timer: { ru: 'Таймер', en: 'Timer' },
  week: { ru: 'Мои часы', en: 'My hours' },
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
