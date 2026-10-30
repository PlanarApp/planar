import { shallowRef, toValue, watch, getCurrentScope, onScopeDispose } from 'vue';
import type { MaybeRefOrGetter, Ref } from 'vue';
import type { Row } from '@planar/shared';
import { db, onReplicaChange, type ReplicaChange } from '../sync';
import { resetDictionaries, warmSpace } from './dictionaries';
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

/** связи по задаче (массивы пар [id, значение]: у задачи их единицы) и по id связи; значения — в порядке id, как полное чтение */
class LinkIndex {
  byId = new Map<string, string>(); // id связи → задача
  byTask = new Map<string, [string, string][]>();
  set(id: string, taskId: string | null, value = ''): string[] {
    const touched: string[] = [];
    const old = this.byId.get(id);
    if (old !== undefined) {
      this.byId.delete(id);
      const list = this.byTask.get(old)!;
      if (list.length > 1)
        this.byTask.set(
          old,
          list.filter((x) => x[0] !== id),
        );
      else this.byTask.delete(old);
      touched.push(old);
    }
    if (taskId) {
      this.byId.set(id, taskId);
      const list = this.byTask.get(taskId);
      if (list) this.byTask.set(taskId, [...list, [id, value]]);
      else this.byTask.set(taskId, [[id, value]]);
      touched.push(taskId);
    }
    return touched;
  }
  /** первичное заполнение строками в порядке id (без проверки старого значения) */
  add(id: string, taskId: string, value: string): void {
    this.byId.set(id, taskId);
    const list = this.byTask.get(taskId);
    if (list) list.push([id, value]);
    else this.byTask.set(taskId, [[id, value]]);
  }
  of(taskId: string): string[] {
    const list = this.byTask.get(taskId);
    if (!list) return [];
    if (list.length > 1) list.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    return list.map((x) => x[1]);
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

function fill(L: Links, as: Row<'taskAssignees'>[], ls: Row<'taskLabels'>[]): void {
  for (const r of as) L.a.add(r.id, r.taskId, r.userId);
  for (const r of ls) L.l.add(r.id, r.taskId, r.labelId);
}

function loadShared(): Links {
  const L: Links = { a: new LinkIndex(), l: new LinkIndex(), queue: [], ready: undefined as never };
  L.ready = (async () => {
    const [as, ls] = await Promise.all([
      db.table<Row<'taskAssignees'>>('taskAssignees').toArray(),
      db.table<Row<'taskLabels'>>('taskLabels').toArray(),
    ]);
    const q = L.queue!;
    L.queue = null;
    fill(L, as, ls);
    applyLinks(L, q); // события, пришедшие во время чтения (идемпотентно)
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

/** реплика не больше — связи читаем целиком не раздумывая (до ~40 тыс. строк); больше — решаем по доле проекта */
const SMALL = 20_000;

function reload(e: Entry): void {
  const run = ++e.run;
  e.tasks = e.arr = e.links = undefined;
  e.queue = [];
  void (async () => {
    const own = (): Promise<[Row<'projects'> | undefined, Row<'tasks'>[]]> =>
      Promise.all([
        db.table<Row<'projects'>>('projects').get(e.pid),
        db.table<Row<'tasks'>>('tasks').where('projectId').equals(e.pid).toArray(),
      ]);
    const read = own();
    let L = shared;
    // связи читаются параллельно с задачами; много проектов — только если проект заметная доля таблицы связей,
    // иначе точечные чтения (anyOf) только его задач
    if (!L && (await db.table('tasks').count()) <= SMALL) L = shared ??= loadShared();
    const [project, tasks] = await read;
    if (!L) {
      const [a, l] = await Promise.all([
        db.table('taskAssignees').count(),
        db.table('taskLabels').count(),
      ]);
      if (tasks.length > 500 && tasks.length * 20 >= a + l) L = shared ??= loadShared();
    }
    if (project) warmSpace(project.spaceId);
    const isOwn = !L;
    if (!L) {
      const ids = tasks.map((t) => t.id);
      L = { a: new LinkIndex(), l: new LinkIndex(), queue: null, ready: Promise.resolve() };
      const [as, ls] = await Promise.all([
        readLinks<Row<'taskAssignees'>>('taskAssignees', ids),
        readLinks<Row<'taskLabels'>>('taskLabels', ids),
      ]);
      fill(L, as, ls);
    }
    await L.ready;
    if (e.run !== run) return;
    e.key = project?.key ?? '?';
    e.links = L;
    e.own = isOwn;
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
      // свой индекс (много проектов) не знает связей появившейся задачи: она может прийти из другого проекта — перечитать
      if (!old && e.own) return -1;
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
  // выданную не вытесняем: подписчик добавится после возврата (иначе он подпишется на сироту без правок)
  for (const [k, x] of entries) {
    if (entries.size <= KEEP) break;
    if (k !== pid && !x.subs.size) entries.delete(k);
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

/** Задачи нескольких проектов (сводка группы): склейка проекций; один проект — его массив как есть. */
export function useScopeTasks(
  projectIds: MaybeRefOrGetter<string[]>,
): Readonly<Ref<TaskView[] | undefined>> {
  const r = shallowRef<TaskView[]>();
  let unsubs: (() => void)[] = [];
  watch(
    () => toValue(projectIds).join(','),
    () => {
      for (const u of unsubs) u();
      const ids = toValue(projectIds);
      const parts: (TaskView[] | undefined)[] = [];
      const publish = () =>
        (r.value = parts.every(Boolean)
          ? parts.length === 1
            ? parts[0]
            : parts.flatMap((p) => p!)
          : undefined);
      // подписка сразу после acquire: иначе проекции без подписчиков вытесняются следующими (KEEP) и не получают правок
      unsubs = ids.map((pid, i) => {
        const e = acquire(pid);
        parts[i] = e.tasks ? snapshot(e) : undefined;
        const f = (a: TaskView[]) => ((parts[i] = a), publish());
        e.subs.add(f);
        return () => e.subs.delete(f);
      });
      publish();
    },
    { immediate: true, flush: 'sync' },
  );
  if (getCurrentScope()) onScopeDispose(() => unsubs.forEach((u) => u()));
  return r;
}

/** в простое: заранее строит проекции первых проектов, пока в памяти есть место */
export function prefetchIdle(projectIds: string[]): void {
  for (const id of projectIds) if (entries.size < KEEP && !entries.has(id)) prefetchProject(id);
}

/** для тестов: проекты в памяти (от давнего к недавнему) */
export const projectionKeys = (): string[] => [...entries.keys()];

/** для тестов: сбросить память проекций и справочников (тесты очищают базу напрямую, минуя события) */
export function resetProjections(): void {
  entries.clear();
  shared = undefined;
  resetDictionaries();
}
