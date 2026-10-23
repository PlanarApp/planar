import { liveQuery, type Subscription } from 'dexie';
import { getCurrentScope, onScopeDispose, readonly, shallowRef, toValue, watch } from 'vue';
import type { MaybeRefOrGetter, Ref } from 'vue';
import type { Row } from '@planar/shared';
import { db, useQuery } from '../sync';

export type TaskView = Row<'tasks'> & { key: string; assigneeIds: string[]; labelIds: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const byStr =
  <T>(f: (x: T) => string) =>
  (a: T, b: T) =>
    f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0;
const byRank = byStr<{ rank: string }>((x) => x.rank);

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
  return readonly(r) as Readonly<Ref<T | undefined>>;
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
  const links = <R extends { taskId: string }>(table: string): Promise<R[]> => {
    const t = db.table<R>(table);
    if (ids.length <= 500) return t.where('taskId').anyOf(ids).toArray();
    // shortcut: на тысячах задач 10 000 точечных запросов по индексу медленнее скана таблицы
    const set = new Set(ids);
    return t.filter((r) => set.has(r.taskId)).toArray();
  };
  const [as, ls] = await Promise.all([
    links<Row<'taskAssignees'>>('taskAssignees'),
    links<Row<'taskLabels'>>('taskLabels'),
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

export const useProject = (id: MaybeRefOrGetter<string>) =>
  useLive(
    () => toValue(id),
    (i) => db.table<Row<'projects'>>('projects').get(i),
  );

export const useStatuses = (spaceId: MaybeRefOrGetter<string>) =>
  useLive(
    () => toValue(spaceId),
    async (s) =>
      (await db.table<Row<'statuses'>>('statuses').where('spaceId').equals(s).toArray()).sort(
        byRank,
      ),
  );

export const useLabels = (spaceId: MaybeRefOrGetter<string>) =>
  useLive(
    () => toValue(spaceId),
    async (s) =>
      (await db.table<Row<'labels'>>('labels').where('spaceId').equals(s).toArray()).sort(
        byStr((l) => l.name),
      ),
  );

export const useMembers = (spaceId: MaybeRefOrGetter<string>) =>
  useLive(
    () => toValue(spaceId),
    async (s) => {
      const ms = await db
        .table<Row<'spaceMembers'>>('spaceMembers')
        .where('spaceId')
        .equals(s)
        .toArray();
      const us = await db.table<Row<'users'>>('users').bulkGet(ms.map((m) => m.userId));
      return us
        .filter((u): u is Row<'users'> => !!u && !u.deactivatedAt)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  );

export const useProjectTasks = (projectId: MaybeRefOrGetter<string>) =>
  useLive(
    () => toValue(projectId),
    async (pid) => {
      const [project, tasks] = await Promise.all([
        db.table<Row<'projects'>>('projects').get(pid),
        db.table<Row<'tasks'>>('tasks').where('projectId').equals(pid).toArray(),
      ]);
      return views(tasks, new Map(project ? [[pid, project.key]] : []));
    },
  );

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
      if (!task) return undefined;
      const p = await db.table<Row<'projects'>>('projects').get(task.projectId);
      return (await views([task], new Map(p ? [[p.id, p.key]] : [])))[0];
    },
  );
