import { liveQuery, type Subscription } from 'dexie';
import { computed, getCurrentScope, onScopeDispose, shallowRef, toValue, watch } from 'vue';
import { i18n } from '../i18n';
import type { MaybeRefOrGetter, Ref } from 'vue';
import type { Row } from '@planar/shared';
import { db, useQuery } from '../sync';
import { byRank } from './dictionaries';
import { readLinks } from './projection';

export { useLabels, useMembers, useStatuses } from './dictionaries';
export { prefetchIdle, prefetchProject, useProjectTasks, useScopeTasks } from './projection';

export type TaskView = Row<'tasks'> & { key: string; assigneeIds: string[]; labelIds: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

/** useQuery с реактивным аргументом: при его смене подписка пересоздаётся. */
function useLive<A, T>(arg: () => A, fn: (a: A) => T | Promise<T>): Readonly<Ref<T | undefined>> {
  const r = shallowRef<T>();
  let sub: Subscription | undefined;
  watch(
    arg,
    (a) => {
      sub?.unsubscribe();
      r.value = undefined;
      sub = liveQuery(() => fn(a)).subscribe({ next: (v) => (r.value = v), error: () => {} });
    },
    { immediate: true, flush: 'sync' },
  );
  if (getCurrentScope()) onScopeDispose(() => sub?.unsubscribe());
  return r; // без readonly(): он оборачивает каждый элемент в Proxy
}

const group = (rows: { taskId: string }[], val: (r: never) => string) => {
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const a = m.get(r.taskId);
    if (a) a.push(val(r as never));
    else m.set(r.taskId, [val(r as never)]);
  }
  return m;
};

async function views(tasks: Row<'tasks'>[], projectKey: Map<string, string>): Promise<TaskView[]> {
  const ids = tasks.map((t) => t.id);
  // одним запросом на все задачи, не по задаче в цикле
  const [as, ls] = await Promise.all([
    readLinks<Row<'taskAssignees'>>('taskAssignees', ids),
    readLinks<Row<'taskLabels'>>('taskLabels', ids),
  ]);
  const am = group(as, (r: Row<'taskAssignees'>) => r.userId);
  const lm = group(ls, (r: Row<'taskLabels'>) => r.labelId);
  return tasks.map((t) => ({
    ...t,
    key: `${projectKey.get(t.projectId) ?? '?'}-${t.number ?? '…'}`,
    assigneeIds: am.get(t.id) ?? [],
    labelIds: lm.get(t.id) ?? [],
  }));
}

export const useProject = (id: MaybeRefOrGetter<string>) =>
  useLive(
    () => toValue(id),
    async (i) => (await db.table<Row<'projects'>>('projects').get(i)) ?? null,
  );

/** Воркспейс: название, цвет, иконка (settings.workspace; по умолчанию — «Planar») */
export function useWorkspace() {
  const row = useQuery(() => db.table<Row<'settings'>>('settings').get('workspace'));
  return computed(() => {
    const v = (row.value?.value ?? {}) as {
      name?: string;
      color?: string | null;
      icon?: string | null;
    };
    return {
      name: v.name || i18n.global.t('app.name'),
      color: v.color ?? null,
      icon: v.icon ?? null,
    };
  });
}

/** корневое пространство «Общее» — уровень Воркспейс (документы и чаты для всех) */
export const useRootSpaceId = () =>
  useQuery(async () => {
    const v = (await db.table<Row<'settings'>>('settings').get('root_space'))?.value;
    return typeof v === 'string' ? v : null;
  });

export function useSpaces() {
  return useQuery(async () => {
    const [spaces, projects] = await Promise.all([
      db.table<Row<'spaces'>>('spaces').toArray(),
      db.table<Row<'projects'>>('projects').toArray(),
    ]);
    const live = projects.filter((p) => !p.archivedAt).sort(byRank);
    return spaces
      .sort(byRank)
      .map((s) => ({ ...s, projects: live.filter((p) => p.spaceId === s.id) }));
  });
}

export const useTask = (idOrKey: MaybeRefOrGetter<string>) =>
  useLive(
    () => toValue(idOrKey),
    async (k) => {
      let task: Row<'tasks'> | undefined;
      if (UUID.test(k)) task = await db.table<Row<'tasks'>>('tasks').get(k);
      else {
        const m = /^(.+)-(\d+)$/.exec(k);
        const p =
          m &&
          (await db
            .table<Row<'projects'>>('projects')
            .filter((x) => x.key === m[1])
            .first());
        task =
          p && m
            ? await db
                .table<Row<'tasks'>>('tasks')
                .where('projectId')
                .equals(p.id)
                .filter((t) => t.number === Number(m[2]))
                .first()
            : undefined;
      }
      if (!task) return null;
      const p = await db.table<Row<'projects'>>('projects').get(task.projectId);
      return (await views([task], new Map(p ? [[p.id, p.key]] : [])))[0];
    },
  );
