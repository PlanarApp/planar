import {
  effectScope,
  onScopeDispose,
  getCurrentScope,
  shallowRef,
  toValue,
  watch,
  type EffectScope,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue';
import type { FilterCtx, FilterTask, Row } from '@planar/shared';
import { db, i18n, localToday, useQuery, useSession, widenByName } from '@planar/web/modules';
import type { Goal, KeyResult, Milestone, MilestoneTask } from '../shared/index.js';

export { mutate as run, newId, rankBetween, openTask, useSpaces } from '@planar/web/modules';
export const hasTables = () => db.tables.some((t) => t.name === 'goalsMilestones');
export const userId = () => useSession().value?.id ?? '';

/** useQuery does not watch a reactive argument — the query is recreated when it changes. */
function useScoped<A, T>(arg: MaybeRefOrGetter<A>, fn: (a: A) => Promise<T>) {
  const out = shallowRef<T>();
  let scope: EffectScope | undefined;
  watch(
    () => toValue(arg),
    (a) => {
      scope?.stop();
      out.value = undefined;
      scope = effectScope();
      scope.run(() => {
        const q = useQuery(() => fn(a));
        watch(q, (v) => (out.value = v as T), { immediate: true, flush: 'sync' });
      });
    },
    { immediate: true, flush: 'sync' },
  );
  if (getCurrentScope()) onScopeDispose(() => scope?.stop());
  return out as Readonly<Ref<T | undefined>>;
}

const bySpace = <T>(t: string, s: string) =>
  db.table(t).where('spaceId').equals(s).toArray() as Promise<T[]>;

export interface GoalsData {
  goals: Goal[];
  krs: KeyResult[];
  tasks: FilterTask[];
  ctx: FilterCtx;
  members: { userId: string; name: string }[];
}

export const useGoalsData = (spaceId: MaybeRefOrGetter<string>) =>
  useScoped(spaceId, async (s): Promise<GoalsData | null> => {
    if (!s || !hasTables()) return null;
    // goalsKeyResults has an index on goalId only
    const goalsP = bySpace<Goal>('goalsGoals', s);
    const [goals, krs, rows, statuses, labels, fieldDefs, members, users] = await Promise.all([
      goalsP,
      goalsP.then(
        (gs) =>
          db
            .table('goalsKeyResults')
            .where('goalId')
            .anyOf(gs.map((g) => g.id))
            .toArray() as Promise<KeyResult[]>,
      ),
      bySpace<Row<'tasks'>>('tasks', s),
      bySpace<Row<'statuses'>>('statuses', s),
      bySpace<Row<'labels'>>('labels', s),
      bySpace<Row<'fieldDefs'>>('fieldDefs', s),
      bySpace<{ userId: string }>('spaceMembers', s),
      db.table('users').toArray() as Promise<{ id: string; name: string }[]>,
    ]);
    const ids = rows.map((t) => t.id);
    const link = async <T extends { taskId: string }>(t: string) =>
      (await db.table(t).where('taskId').anyOf(ids).toArray()) as unknown as T[];
    const [as, ls] = await Promise.all([
      link<{ taskId: string; userId: string }>('taskAssignees'),
      link<{ taskId: string; labelId: string }>('taskLabels'),
    ]);
    const pick = <T extends { taskId: string }>(xs: T[], f: (x: T) => string) => {
      const m = new Map<string, string[]>();
      for (const x of xs) m.set(x.taskId, [...(m.get(x.taskId) ?? []), f(x)]);
      return m;
    };
    const am = pick(as, (x) => x.userId);
    const lm = pick(ls, (x) => x.labelId);
    const tasks = rows.map((t) => ({
      ...t,
      assigneeIds: am.get(t.id) ?? [],
      labelIds: lm.get(t.id) ?? [],
    }));
    const name = new Map(users.map((u) => [u.id, u.name]));
    return {
      goals: goals.sort((a, b) => (a.rank < b.rank ? -1 : 1)),
      // a status/label rule covers same-named rows of all the space's projects, as in the lists
      krs: krs
        .map((k) =>
          k.filter
            ? {
                ...k,
                filter: { ...k.filter, filter: widenByName(k.filter.filter, statuses, labels) },
              }
            : k,
        )
        .sort((a, b) => (a.rank < b.rank ? -1 : 1)),
      tasks,
      ctx: { statuses, fieldDefs, userId: userId(), today: localToday() },
      members: members.map((m) => ({ userId: m.userId, name: name.get(m.userId) ?? m.userId })),
    };
  });

export interface MilestoneData {
  projectKey: string;
  milestones: Milestone[];
  links: MilestoneTask[];
  tasks: Row<'tasks'>[];
  statuses: Row<'statuses'>[];
}

export const useMilestoneData = (projectId: MaybeRefOrGetter<string>) =>
  useScoped(projectId, async (p): Promise<MilestoneData | null> => {
    if (!p || !hasTables()) return null;
    const project = (await db.table('projects').get(p)) as Row<'projects'> | undefined;
    const [milestones, tasks] = await Promise.all([
      db.table('goalsMilestones').where('projectId').equals(p).toArray() as Promise<Milestone[]>,
      db.table('tasks').where('projectId').equals(p).toArray() as Promise<Row<'tasks'>[]>,
    ]);
    const links = (await db
      .table('goalsMilestoneTasks')
      .where('milestoneId')
      .anyOf(milestones.map((m) => m.id))
      .toArray()) as MilestoneTask[];
    const statuses = project ? await bySpace<Row<'statuses'>>('statuses', project.spaceId) : [];
    return {
      projectKey: project?.key ?? '?',
      milestones: milestones.sort((a, b) => (a.date < b.date ? -1 : 1)),
      links,
      tasks,
      statuses,
    };
  });

const TEXT = {
  ru: {
    goals: 'Цели',
    milestones: 'Вехи',
    milestone: 'Веха',
    noMilestone: 'Без вехи',
    space: 'Пространство',
    name: 'Название',
    date: 'Дата',
    create: 'Создать',
    del: 'Удалить',
    archive: 'В архив',
    restore: 'Вернуть',
    showArchive: 'Архив',
    empty:
      'Целей пока нет. Пример: цель «Запустить бету», ключевые результаты — «100 регистраций» (число) и «закрыть задачи с меткой beta» (задачи по фильтру).',
    intro:
      'Цель — то, чего хотите достичь за период. Её прогресс — среднее по ключевым результатам. Ключевой результат: «Число» — вы сами обновляете текущее значение (от старта к цели); «Задачи по фильтру» — доля выполненных задач, подходящих под фильтр, считается сама.',
    hintNumber:
      'Укажите старт и цель; текущее значение вводите в строке результата по мере продвижения.',
    hintTasks:
      'Выберите задачи фильтром (проект, метка, спринт…); прогресс — доля выполненных из них.',
    addGoal: 'Новая цель',
    addKr: 'Ключевой результат',
    kind: 'Тип',
    number: 'Число',
    tasks: 'Задачи по фильтру',
    start: 'Старт',
    target: 'Цель',
    current: 'Текущее',
    unit: 'Единица',
    progress: 'Прогресс',
    noKr: 'Нет ключевых результатов',
    badMetric: 'Старт и цель должны различаться',
    cat: {
      backlog: 'Бэклог',
      todo: 'К выполнению',
      in_progress: 'В работе',
      done: 'Готово',
      cancelled: 'Отменено',
    },
  },
  en: {
    goals: 'Goals',
    milestones: 'Milestones',
    milestone: 'Milestone',
    noMilestone: 'No milestone',
    space: 'Space',
    name: 'Name',
    date: 'Date',
    create: 'Create',
    del: 'Delete',
    archive: 'Archive',
    restore: 'Restore',
    showArchive: 'Archive',
    empty:
      'No goals yet. Example: goal "Launch the beta", key results "100 sign-ups" (number) and "close tasks labelled beta" (tasks by filter).',
    intro:
      'A goal is what you want to reach in a period; its progress is the average of its key results. A key result: "Number" — you update the current value yourself (from start to target); "Tasks by filter" — the share of done tasks matching the filter, computed automatically.',
    hintNumber:
      'Set start and target; enter the current value in the key result row as you progress.',
    hintTasks:
      'Pick the tasks with a filter (project, label, sprint…); progress is the share of them done.',
    addGoal: 'New goal',
    addKr: 'Key result',
    kind: 'Type',
    number: 'Number',
    tasks: 'Tasks by filter',
    start: 'Start',
    target: 'Target',
    current: 'Current',
    unit: 'Unit',
    progress: 'Progress',
    noKr: 'No key results',
    badMetric: 'Start and target must differ',
    cat: {
      backlog: 'Backlog',
      todo: 'Todo',
      in_progress: 'In progress',
      done: 'Done',
      cancelled: 'Cancelled',
    },
  },
};
export const text = () => TEXT[i18n.global.locale.value as 'ru' | 'en'] ?? TEXT.ru;
