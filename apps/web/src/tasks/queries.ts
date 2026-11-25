import { computed, toValue } from 'vue';
import { i18n } from '../i18n';
import type { MaybeRefOrGetter } from 'vue';
import type { AssignedComments, Row } from '@planar/shared';
import { useLive } from '../links/live';
import { db, useQuery } from '../sync';
import { byRank, taskCache, useShared } from './dictionaries';
import { assignedCommentsView, readLinks } from './projection';

export { useLabels, useMembers, useStatuses } from './dictionaries';
export { prefetchIdle, prefetchProject, useProjectTasks, useScopeTasks } from './projection';

export type TaskView = Row<'tasks'> & {
  key: string;
  assigneeIds: string[];
  labelIds: string[];
  /** PLNRAPP-576: assigned comments of the task (not of subtasks); assignedToMe — for the signed-in user */
  assignedComments: AssignedComments;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

const group = (rows: { taskId: string }[], val: (r: never) => string) => {
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const a = m.get(r.taskId);
    if (a) a.push(val(r as never));
    else m.set(r.taskId, [val(r as never)]);
  }
  return m;
};

/** tasks → TaskView (key, assignees, labels, assigned comments) in one query per link table */
export async function views(
  tasks: Row<'tasks'>[],
  projectKey: Map<string, string>,
): Promise<TaskView[]> {
  const ids = tasks.map((t) => t.id);
  // one query for all tasks, not one per task in a loop
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
    assignedComments: assignedCommentsView(t),
  }));
}

export const useProject = (id: MaybeRefOrGetter<string>) =>
  useLive(
    () => toValue(id),
    async (i) => (await db.table<Row<'projects'>>('projects').get(i)) ?? null,
  );

/** Workspace: name, colour, icon (settings.workspace; default — "Planar") */
export function useWorkspace() {
  const row = useQuery(() => db.table<Row<'settings'>>('settings').get('workspace'));
  return computed(() => {
    const v = (row.value?.value ?? {}) as {
      name?: string;
      color?: string | null;
      icon?: string | null;
      mfa?: 'off' | 'admins' | 'all';
    };
    return {
      name: v.name || i18n.global.t('app.name'),
      color: v.color ?? null,
      icon: v.icon ?? null,
      /** 2FA policy (admin, settings): off — optional */
      mfa: v.mfa ?? 'off',
    };
  });
}

/** root space "General" — Workspace level (documents and chats for everyone) */
export const useRootSpaceId = () =>
  useQuery(async () => {
    const v = (await db.table<Row<'settings'>>('settings').get('root_space'))?.value;
    return typeof v === 'string' ? v : null;
  });

/** Ids of archived projects: their statuses, labels and fields are not filter options of a space summary (PLNRAPP-508). */
export const useArchivedProjectIds = () =>
  useQuery(
    async () =>
      new Set(
        (await db.table<Row<'projects'>>('projects').toArray())
          .filter((p) => p.archivedAt)
          .map((p) => p.id),
      ),
  );

/** Rows of live projects only (`archived` — from useArchivedProjectIds). */
export const notArchived = <T extends { projectId?: string | null }>(
  rows: T[] | undefined,
  archived: Set<string> | undefined,
): T[] => (rows ?? []).filter((r) => !r.projectId || !archived?.has(r.projectId));

/** Spaces with their live projects: one subscription for all (TaskDetail, breadcrumbs, pickers). */
export const useSpaces = () => useShared('sp', () => '', spaceTree);
async function spaceTree() {
  const [spaces, projects] = await Promise.all([
    db.table<Row<'spaces'>>('spaces').toArray(),
    db.table<Row<'projects'>>('projects').toArray(),
  ]);
  const live = projects.filter((p) => !p.archivedAt).sort(byRank);
  return spaces
    .sort(byRank)
    .map((s) => ({ ...s, projects: live.filter((p) => p.spaceId === s.id) }));
}

const TASK_CACHE = 50;
/** last read tasks by id and by key: the panel opens with a ready task, not an empty frame */
const remember = (k: string, t: TaskView | null) => {
  for (const x of t ? new Set([k, t.id, t.key]) : [k]) {
    taskCache.delete(x);
    taskCache.set(x, t);
  }
  while (taskCache.size > TASK_CACHE) taskCache.delete(taskCache.keys().next().value!);
  return t;
};

const readTask = async (k: string): Promise<TaskView | null> => {
  let task: Row<'tasks'> | undefined;
  if (UUID.test(k)) task = await db.table<Row<'tasks'>>('tasks').get(k);
  else {
    const m = /^(.+)-(\d+)$/.exec(k);
    const projects = db.table<Row<'projects'>>('projects');
    const tasks = db.table<Row<'tasks'>>('tasks');
    const byNumber = (p: Row<'projects'> | undefined) =>
      p && m
        ? tasks
            .where('[projectId+number]')
            .equals([p.id, Number(m[2])])
            .first()
        : undefined;
    try {
      task = await byNumber(m ? await projects.where('key').equals(m[1]!).first() : undefined);
    } catch {
      // the replica's schema lacks the client indexes (its version record in localStorage is lost): scan as before
      const p = m ? await projects.filter((x) => x.key === m[1]).first() : undefined;
      task =
        p && m
          ? await tasks
              .where('projectId')
              .equals(p.id)
              .filter((t) => t.number === Number(m[2]))
              .first()
          : undefined;
    }
  }
  if (!task) return null;
  const p = await db.table<Row<'projects'>>('projects').get(task.projectId);
  return (await views([task], new Map(p ? [[p.id, p.key]] : [])))[0] ?? null;
};

/** Reads the task into the cache before the panel opens (openTask), so the first frame is complete. */
export const primeTask = async (k: string): Promise<void> => void remember(k, await readTask(k));

export const useTask = (idOrKey: MaybeRefOrGetter<string>) =>
  useLive(
    () => toValue(idOrKey),
    async (k) => remember(k, await readTask(k)),
    (k) => (taskCache.get(k) as TaskView | null | undefined) ?? undefined,
  );
