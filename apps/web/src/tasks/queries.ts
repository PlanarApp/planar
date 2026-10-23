import { liveQuery, type Subscription } from 'dexie';
import { getCurrentScope, onScopeDispose, shallowRef, toValue, watch, type WatchHandle } from 'vue';
import type { MaybeRefOrGetter, Ref } from 'vue';
import type { Row } from '@planar/shared';
import { db, useQuery } from '../sync';
import { readLinks } from './projection';

export { prefetchIdle, prefetchProject, useProjectTasks } from './projection';

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
    async (i) => (await db.table<Row<'projects'>>('projects').get(i)) ?? null,
  );

/**
 * Справочники пространства (статусы, метки, участники): один liveQuery на (вид, spaceId) на всех подписчиков,
 * а не по запросу на каждый пикер в каждой строке.
 */
const shared = new Map<string, { r: Ref<unknown>; sub: Subscription; n: number }>();
function useShared<T>(kind: string, arg: () => string, fn: (a: string) => Promise<T>) {
  const out = shallowRef<T>();
  let key = '';
  let follow: WatchHandle | undefined;
  const release = () => {
    follow?.stop();
    const x = shared.get(key);
    if (x && --x.n === 0) {
      x.sub.unsubscribe();
      shared.delete(key);
    }
  };
  const stop = watch(
    arg,
    (a) => {
      if (key) release();
      key = kind + a;
      let x = shared.get(key);
      if (!x) {
        const r = shallowRef<T>();
        const sub = liveQuery(() => fn(a)).subscribe({
          next: (v) => (r.value = v),
          error: () => {},
        });
        shared.set(key, (x = { r, sub, n: 0 }));
      }
      x.n++;
      out.value = x.r.value as T;
      follow = watch(x.r, (v) => (out.value = v as T), { flush: 'sync' });
    },
    { immediate: true, flush: 'sync' },
  );
  if (getCurrentScope())
    onScopeDispose(() => {
      stop();
      release();
    });
  return out as Readonly<Ref<T | undefined>>;
}

export const useStatuses = (spaceId: MaybeRefOrGetter<string>) =>
  useShared(
    'st',
    () => toValue(spaceId),
    async (s) =>
      (await db.table<Row<'statuses'>>('statuses').where('spaceId').equals(s).toArray()).sort(
        byRank,
      ),
  );

export const useLabels = (spaceId: MaybeRefOrGetter<string>) =>
  useShared(
    'lb',
    () => toValue(spaceId),
    async (s) =>
      (await db.table<Row<'labels'>>('labels').where('spaceId').equals(s).toArray()).sort(
        byStr((l) => l.name),
      ),
  );

export const useMembers = (spaceId: MaybeRefOrGetter<string>) =>
  useShared(
    'mb',
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
