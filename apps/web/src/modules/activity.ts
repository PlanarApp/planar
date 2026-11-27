// PLNRAPP-202: the indicator of a module's background work (an AI run) — on a task, its comments and checklist
// items, in a chat channel. The sources are the modules' `activity` extensions; the state lives only here.
import {
  computed,
  effectScope,
  getCurrentScope,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
  type InjectionKey,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue';
import { onReplicaChange, type ReplicaChange } from '../sync';
import { onWork, type WorkEvent } from '../sync/work';
import { useExtensions } from './registry';
import type { ActivitySourceDef, WorkActivity } from './types';

/** Polling while something runs or waits in the queue (the entities without work signals, see SIGNALED). */
export const ACTIVITY_POLL_MS = 3000;
/** After a change of the replica a run may start a moment later (the queue): poll this long anyway. */
export const ACTIVITY_GRACE_MS = 10_000;
const DEBOUNCE_MS = 400;

/** The work with its module: the error link opens the task panel `<moduleId>:<panel>`. */
export type Activity = WorkActivity & { moduleId: string };

/**
 * The replica changes that may start or finish a run of the entity. PLNRAPP-838: an assignee (the AI assigned in
 * the backlog starts a rule) is a row of taskAssignees, not of tasks.
 */
const RELEVANT: Record<ActivitySourceDef['entity'], string[]> = {
  tasks: ['tasks', 'taskAssignees', 'comments', 'checklistItems'],
  chatChannels: ['chatMessages'],
  pages: ['docsComments'],
  projects: ['tasks', 'taskAssignees', 'comments', 'checklistItems'],
};

/**
 * PLNRAPP-884: the server signals a change of a task's AI run (WS `work`, migration 0100): the task card reloads
 * on the signal instead of polling while a run runs or waits. The queue's jobs without a run have no signal: while
 * something is queued, and in the grace after a replica change, it still polls. The project's lists still poll.
 */
const SIGNALED: ReadonlySet<ActivitySourceDef['entity']> = new Set(['tasks']);
/** PLNRAPP-884: a run counts on the tab while it runs or waits; done / failed — not. */
export const ACTIVE_STATES: ReadonlySet<WorkActivity['state']> = new Set([
  'queued',
  'running',
  'waiting_human',
  'waiting_subtasks',
]);
/** PLNRAPP-884: the count of the task panel `<moduleId>:<panel>` — the works running or waiting there. */
export function activeByPanel(list: readonly Activity[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of list)
    if (a.panel && ACTIVE_STATES.has(a.state)) {
      const k = `${a.moduleId}:${a.panel}`;
      out[k] = (out[k] ?? 0) + 1;
    }
  return out;
}

const RANK = {
  running: 0,
  waiting_human: 1,
  waiting_subtasks: 2,
  queued: 3,
  failed: 4,
  done: 5,
} as const;
/** The most telling work of an item (running first, then waiting, queued, the error, done); undefined itemId — of all. */
export function activityOf(
  list: readonly Activity[],
  itemId?: string | null,
): Activity | undefined {
  return list
    .filter((a) => itemId === undefined || a.itemId === itemId)
    .reduce<Activity | undefined>(
      (best, a) => (!best || RANK[a.state] < RANK[best.state] ? a : best),
      undefined,
    );
}

/** Whole minutes since the start (≥ 0). */
export const minutesSince = (startedAt: string, now: number): number =>
  Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000));

/** The task card's work: the comments and the checklist take it from here instead of loading it again. */
export const TASK_ACTIVITY: InjectionKey<{
  items: Ref<Activity[]>;
  /** the error link: the task panel of the module with the run */
  open: (a: Activity) => void;
  /** «Отменить» of a queued work: gone at once, the next load confirms */
  cancel: (a: Activity) => void;
}> = Symbol('taskActivity');

/**
 * The work on the entity (a task or a chat channel) from the modules on in the project: loaded at once, again on
 * a change of the replica, and every 3 s while something runs. A failed source is silent (no rights, module off).
 */
export function useActivity(
  entity: ActivitySourceDef['entity'],
  id: MaybeRefOrGetter<string | undefined>,
  projectId?: MaybeRefOrGetter<string | undefined>,
): Ref<Activity[]> {
  const sources = useExtensions('activity', projectId);
  const items = ref<Activity[]>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let graceUntil = 0;
  let seq = 0;
  let alive = true;

  async function load() {
    clearTimeout(timer);
    const cur = toValue(id);
    const my = ++seq;
    const list = sources.value.filter((s) => s.entity === entity);
    if (!cur || !list.length) {
      items.value = [];
      return;
    }
    const got = await Promise.all(
      list.map((s) =>
        s.load(cur).then(
          (xs) => xs.map((x) => ({ ...x, moduleId: s.moduleId })),
          () => [] as Activity[],
        ),
      ),
    );
    if (!alive || my !== seq) return;
    const live = (xs: Activity[]) => xs.some((a) => a.state === 'running' || a.state === 'queued');
    // PLNRAPP-532: a queued job is taken but its run is not written yet — a moment with nothing live; without a
    // grace the polling would stop and miss the run (a finished run stops it: nothing follows)
    if (items.value.some((a) => a.state === 'queued') && !live(got.flat()))
      graceUntil = Math.max(graceUntil, Date.now() + ACTIVITY_GRACE_MS);
    items.value = got.flat();
    const polled = SIGNALED.has(entity)
      ? items.value.some((a) => a.state === 'queued')
      : live(items.value);
    if (polled || Date.now() < graceUntil) timer = setTimeout(load, ACTIVITY_POLL_MS);
  }

  // a change of another task/project doesn't matter; a deletion carries no row (only the id) — counts for everyone
  const isMine = (c: ReplicaChange) => {
    const cur = toValue(id);
    const r = c.row;
    if (!r || !cur) return true;
    if (entity === 'tasks') return (c.entity === 'tasks' ? c.id : r.taskId) === cur;
    // a project's child rows carry only taskId: can't tell the project without a lookup — shortcut: any counts
    return c.entity === 'tasks' && entity === 'projects' ? r.projectId === cur : true;
  };
  const off = onReplicaChange((batch: ReplicaChange[]) => {
    if (!batch.some((c) => RELEVANT[entity].includes(c.entity) && isMine(c))) return;
    graceUntil = Date.now() + ACTIVITY_GRACE_MS;
    clearTimeout(debounce);
    debounce = setTimeout(load, DEBOUNCE_MS);
  });
  // PLNRAPP-884: a run of the task changed — reload, no polling
  const isMyWork = (e: WorkEvent) =>
    e.entity === '*' || (e.entity === 'tasks' && e.id === toValue(id));
  const offWork = SIGNALED.has(entity)
    ? onWork((e) => {
        if (!isMyWork(e)) return;
        clearTimeout(debounce);
        debounce = setTimeout(load, DEBOUNCE_MS);
      })
    : () => {};
  watch(
    [() => toValue(id), () => sources.value.map((s) => s.key).join()],
    () => {
      items.value = [];
      void load();
    },
    { immediate: true },
  );
  if (getCurrentScope())
    onScopeDispose(() => {
      alive = false;
      off();
      offWork();
      clearTimeout(timer);
      clearTimeout(debounce);
    });
  return items;
}

const shared = new Map<string, { items: Ref<Activity[]>; refs: number; stop: () => void }>();
function acquire(projectId: string): Ref<Activity[]> {
  let e = shared.get(projectId);
  if (!e) {
    const scope = effectScope(true);
    const items = scope.run(() => useActivity('projects', projectId, projectId))!;
    e = { items, refs: 0, stop: () => scope.stop() };
    shared.set(projectId, e);
  }
  e.refs++;
  return e.items;
}
function release(projectId: string) {
  const e = shared.get(projectId);
  if (e && --e.refs === 0) {
    e.stop();
    shared.delete(projectId);
  }
}

/**
 * PLNRAPP-322: the work on the tasks of a project (itemId — the task) for the list rows and the board cards: one
 * source per project shared by all rows, not a request per row; stopped when the last row is gone.
 */
export function useProjectActivity(projectId: () => string): Ref<Activity[]> {
  const cur = shallowRef<Ref<Activity[]>>();
  let held: string | undefined;
  watch(
    projectId,
    (pid) => {
      cur.value = acquire(pid);
      if (held) release(held);
      held = pid;
    },
    { immediate: true },
  );
  if (getCurrentScope()) onScopeDispose(() => held && release(held));
  return computed(() => cur.value?.value ?? []);
}

/** A clock for «N мин»: ticks every 30 s while the scope lives. */
export function useNow(stepMs = 30_000): Ref<number> {
  const now = ref(Date.now());
  const t = setInterval(() => (now.value = Date.now()), stepMs);
  if (getCurrentScope()) onScopeDispose(() => clearInterval(t));
  return now;
}
