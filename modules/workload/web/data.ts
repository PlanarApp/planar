// The module's single point of contact with the web core.
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
import { effectScope, onScopeDispose, shallowRef, watch, type EffectScope, type Ref } from 'vue';
import type { WorkloadCapacity } from '../shared/index.js';

export { mutate, newId, useWeekStart, useSpaces, openTask };
export const userId = () => useSession().value?.id ?? '';

interface Base {
  id: string;
}
const all = <T>(t: string, spaceId: string) =>
  db.table(t).where('spaceId').equals(spaceId).toArray() as Promise<T[]>;

/** Space data for the table; `time` — whether the time module is enabled (there are estimates). */
export const useWorkloadData = (spaceId: () => string) => {
  // useQuery does not watch a reactive spaceId — the query is recreated when the space changes
  const out = shallowRef<Data | null>();
  let scope: EffectScope | undefined;
  watch(
    spaceId,
    (s) => {
      scope?.stop();
      scope = effectScope();
      scope.run(() => {
        const q = useQuery(() => load(s));
        watch(q, (v) => (out.value = v), { immediate: true });
      });
    },
    { immediate: true },
  );
  onScopeDispose(() => scope?.stop());
  return out as Readonly<Ref<Data | null | undefined>>;
};

const load = async (s: string) => {
  if (!s) return null;
  const has = (n: string) => db.tables.some((t) => t.name === n);
  const tasks = await all<{
    id: string;
    statusId: string;
    dueDate: string | null;
    startDate: string | null;
    title: string;
    number: number | null;
    projectId: string;
  }>('tasks', s);
  // taskAssignees/timeEstimates have no spaceId index — read by the taskId index
  const ids = tasks.map((t) => t.id);
  const byTask = <T>(t: string) => db.table(t).where('taskId').anyOf(ids).toArray() as Promise<T[]>;
  const [assignees, statuses, members, caps, projects, estimates, users] = await Promise.all([
    byTask<{ taskId: string; userId: string }>('taskAssignees'),
    all<Base & { category: string }>('statuses', s),
    all<{ userId: string; role: string }>('spaceMembers', s),
    has('workloadCapacities') ? all<WorkloadCapacity>('workloadCapacities', s) : [],
    all<Base & { key: string }>('projects', s),
    has('timeEstimates') ? byTask<{ taskId: string; minutes: number }>('timeEstimates') : null,
    db.table('users').toArray() as Promise<{ id: string; name: string }[]>,
  ]);
  return { tasks, assignees, statuses, members, caps, projects, estimates, users };
};
type Data = NonNullable<Awaited<ReturnType<typeof load>>>;

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
