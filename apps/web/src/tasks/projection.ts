import { shallowRef, toValue, watch, getCurrentScope, onScopeDispose } from 'vue';
import type { MaybeRefOrGetter, Ref } from 'vue';
import type { Row } from '@planar/shared';
import { db, onReplicaChange, type ReplicaChange } from '../sync';
import type { TaskView } from './queries';

/** связи задач по id: точечными запросами, пока проект — малая доля таблицы, иначе чтение таблицы целиком и фильтр */
export async function readLinks<R extends { taskId: string }>(
  table: string,
  ids: string[],
): Promise<R[]> {
  const t = db.table<R>(table);
  // курсорный скан (filter().toArray()) в разы медленнее getAll
  if (ids.length <= 500 || ids.length * 20 < (await t.count()))
    return t.where('taskId').anyOf(ids).toArray();
  const set = new Set(ids);
  return (await t.toArray()).filter((r) => set.has(r.taskId));
}

/**
 * Проекция задач проекта в памяти (C-tasks v3). Проект читается из IndexedDB один раз, дальше патчится
 * событиями `onReplicaChange`; до `KEEP` последних проектов остаются в памяти (LRU).
 * Связи (исполнители, метки) хранятся в индексе по задаче: общем на все проекты, если проект — заметная
 * доля таблицы связей, иначе (много проектов) — свой на проект и с чтением anyOf.
 */
const KEEP = 3;

/** связь id → (задача, значение) и индекс по задаче; значения отдаёт в порядке id, как полное чтение */
class LinkIndex {
  byId = new Map<string, [string, string]>();
  byTask = new Map<string, Map<string, string>>();
  set(id: string, taskId: string | null, value = ''): string[] {
    const touched: string[] = [];
    const old = this.byId.get(id);
    if (old) {
      this.byId.delete(id);
      this.byTask.get(old[0])?.delete(id);
      touched.push(old[0]);
    }
    if (taskId) {
      this.byId.set(id, [taskId, value]);
      let m = this.byTask.get(taskId);
      if (!m) this.byTask.set(taskId, (m = new Map()));
      m.set(id, value);
      touched.push(taskId);
    }
    return touched;
  }
  of(taskId: string): string[] {
    const m = this.byTask.get(taskId);
    if (!m) return [];
    return [...m].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map((x) => x[1]);
  }
}
interface Links {
  a: LinkIndex;
  l: LinkIndex;
  /** события, пришедшие во время чтения (null — прочитано) */
  queue: ReplicaChange[] | null;
  ready: Promise<void>;
}

/** применяет строки связей; accept — брать ли связь этой задачи (индекс проекта берёт только свои) */
function applyLinks(
  L: Links,
  cs: ReplicaChange[],
  accept?: (taskId: string) => boolean,
): Set<string> {
  const touched = new Set<string>();
  for (const c of cs) {
    const idx = c.entity === 'taskAssignees' ? L.a : c.entity === 'taskLabels' ? L.l : null;
    if (!idx) continue;
    const t = c.row ? (c.row.taskId as string) : null;
    const v = c.row
      ? ((c.entity === 'taskAssignees' ? c.row.userId : c.row.labelId) as string)
      : '';
    for (const x of idx.set(c.id, t && (!accept || accept(t)) ? t : null, v)) touched.add(x);
  }
  return touched;
}

let shared: Links | undefined; // общий индекс связей всех задач

function loadShared(): Links {
  const L: Links = { a: new LinkIndex(), l: new LinkIndex(), queue: [], ready: undefined as never };
  L.ready = (async () => {
    const [as, ls] = await Promise.all([
      db.table<Row<'taskAssignees'>>('taskAssignees').toArray(),
      db.table<Row<'taskLabels'>>('taskLabels').toArray(),
    ]);
    const q = L.queue!;
    L.queue = null;
    applyLinks(L, [
      ...as.map((r) => ({ entity: 'taskAssignees', id: r.id, row: r })),
      ...ls.map((r) => ({ entity: 'taskLabels', id: r.id, row: r })),
      ...q,
    ]);
  })();
  return L;
}

interface Entry {
  pid: string;
  key: string;
  tasks?: Map<string, TaskView>; // undefined — идёт чтение
  links?: Links;
  own: boolean; // индекс связей свой (не общий)
  arr?: TaskView[]; // снимок для подписчиков; undefined — устарел
  queue: ReplicaChange[]; // события во время чтения
  run: number;
  subs: Set<(a: TaskView[]) => void>;
}
const entries = new Map<string, Entry>();
let off: (() => void) | undefined;

const view = (e: Entry, t: Row<'tasks'>): TaskView => ({
  ...t,
  key: `${e.key}-${t.number ?? '…'}`,
  assigneeIds: e.links!.a.of(t.id),
  labelIds: e.links!.l.of(t.id),
});
const snapshot = (e: Entry) => (e.arr ??= [...e.tasks!.values()]);

function reload(e: Entry): void {
  const run = ++e.run;
  e.tasks = e.arr = e.links = undefined;
  e.queue = [];
  void (async () => {
    const [project, tasks] = await Promise.all([
      db.table<Row<'projects'>>('projects').get(e.pid),
      db.table<Row<'tasks'>>('tasks').where('projectId').equals(e.pid).toArray(),
    ]);
    // ветвление по доле проекта: заметная доля таблицы связей — общий индекс, иначе точечные чтения
    const ids = tasks.map((t) => t.id);
    let L: Links | undefined = shared;
    let own = false;
    if (!L && ids.length > 500) {
      const total =
        (await db.table('taskAssignees').count()) + (await db.table('taskLabels').count());
      if (ids.length * 20 >= total) L = shared = loadShared();
    }
    if (!L) {
      own = true;
      L = { a: new LinkIndex(), l: new LinkIndex(), queue: null, ready: Promise.resolve() };
      const [as, ls] = await Promise.all([
        readLinks<Row<'taskAssignees'>>('taskAssignees', ids),
        readLinks<Row<'taskLabels'>>('taskLabels', ids),
      ]);
      applyLinks(L, [
        ...as.map((r) => ({ entity: 'taskAssignees', id: r.id, row: r })),
        ...ls.map((r) => ({ entity: 'taskLabels', id: r.id, row: r })),
      ]);
    }
    await L.ready;
    if (e.run !== run) return;
    e.key = project?.key ?? '?';
    e.links = L;
    e.own = own;
    e.tasks = new Map();
    for (const t of tasks) e.tasks.set(t.id, view(e, t));
    const q = e.queue;
    e.queue = [];
    if (patch(e, q) < 0) return reload(e);
    publish(e);
  })();
}

function publish(e: Entry): void {
  e.arr = undefined;
  if (e.subs.size) {
    const a = snapshot(e);
    e.subs.forEach((f) => f(a));
  }
}

/** -1 — проект надо перечитать (сброс реплики, сменился сам проект, задача пришла из другого проекта), 0 — не менялся, 1 — изменился */
function patch(e: Entry, cs: ReplicaChange[], touched?: Set<string>): -1 | 0 | 1 {
  const tasks = e.tasks!;
  const dirty = new Set(touched);
  let changed = 0;
  for (const c of cs) {
    if (c.entity === '*' || (c.entity === 'projects' && c.id === e.pid)) return -1;
    if (e.own && (c.entity === 'taskAssignees' || c.entity === 'taskLabels'))
      for (const t of applyLinks(e.links!, [c], (t) => tasks.has(t))) dirty.add(t);
    if (c.entity !== 'tasks') continue;
    const old = tasks.get(c.id);
    if (c.row && c.row.projectId === e.pid) {
      // свой индекс не знает связей задачи, пришедшей из другого проекта (у новой задачи номера ещё нет)
      if (!old && e.own && c.row.number != null) return -1;
      tasks.set(c.id, view(e, c.row as Row<'tasks'>));
      dirty.delete(c.id);
      changed = 1;
    } else if (old) {
      tasks.delete(c.id);
      dirty.delete(c.id);
      changed = 1;
    }
  }
  for (const id of dirty) {
    const t = tasks.get(id);
    if (!t) continue;
    tasks.set(id, { ...t, assigneeIds: e.links!.a.of(id), labelIds: e.links!.l.of(id) });
    changed = 1;
  }
  return changed as 0 | 1;
}

function onChanges(cs: ReplicaChange[]): void {
  if (cs.some((c) => c.entity === '*')) shared = undefined;
  let touched: Set<string> | undefined;
  if (shared) {
    if (shared.queue) shared.queue.push(...cs);
    else touched = applyLinks(shared, cs);
  }
  for (const e of entries.values()) {
    if (!e.tasks) {
      e.queue.push(...cs);
      continue;
    }
    const r = patch(e, cs, touched);
    if (r < 0) reload(e);
    else if (r) publish(e);
  }
}

function acquire(pid: string): Entry {
  off ??= onReplicaChange(onChanges);
  let e = entries.get(pid);
  if (e)
    entries.delete(pid); // обновить порядок LRU
  else {
    e = { pid, key: '?', own: false, queue: [], run: 0, subs: new Set() };
    reload(e);
  }
  entries.set(pid, e);
  for (const [k, x] of entries) {
    if (entries.size <= KEEP) break;
    if (!x.subs.size) entries.delete(k);
  }
  return e;
}

/** Заранее строит проекцию проекта; повторный вызов ничего не делает. */
export const prefetchProject = (projectId: string): void => void acquire(projectId);

export function useProjectTasks(
  projectId: MaybeRefOrGetter<string>,
): Readonly<Ref<TaskView[] | undefined>> {
  const r = shallowRef<TaskView[]>();
  let unsub: (() => void) | undefined;
  watch(
    () => toValue(projectId),
    (pid) => {
      unsub?.();
      const e = acquire(pid);
      const f = (a: TaskView[]) => (r.value = a);
      e.subs.add(f);
      unsub = () => e.subs.delete(f);
      r.value = e.tasks ? snapshot(e) : undefined;
    },
    { immediate: true, flush: 'sync' },
  );
  if (getCurrentScope()) onScopeDispose(() => unsub?.());
  return r;
}

/** в простое: заранее строит проекции первых проектов, пока в памяти есть место */
export function prefetchIdle(projectIds: string[]): void {
  for (const id of projectIds) if (entries.size < KEEP && !entries.has(id)) prefetchProject(id);
}

/** для тестов: сбросить память проекций */
export function resetProjections(): void {
  entries.clear();
  shared = undefined;
}
