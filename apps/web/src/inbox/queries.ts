import { computed } from 'vue';
import type { Row } from '@planar/shared';
import { db, useQuery } from '../sync';
import { docText } from '../command/search';
import { isSnoozed, snoozed } from './snooze';
import { forMeTaskIds } from '../views/saved/useFilter';

export type InboxItem = Row<'notifications'> & {
  actorName: string;
  taskKey: string | null;
  taskTitle: string;
  /** group level: project of the task or channel; null — space (spaceId) or personal dialog */
  projectId: string | null;
  /** what changed: status "from → to" (status_changed), comment text (commented, mentioned) */
  status: [Status, Status] | null;
  comment: string | null;
};
type Status = { name: string; color: string };

const CHANNEL = /^\/m\/chat\/c\/([0-9a-f-]{36})/;
const PAGE = /^\/m\/docs\/([0-9a-f-]{36})/;

export const useNotifications = () =>
  useQuery(async (): Promise<InboxItem[]> => {
    const ns = await db.table<Row<'notifications'>>('notifications').toArray();
    const [tasks, users] = await Promise.all([
      db
        .table<Row<'tasks'>>('tasks')
        .bulkGet([...new Set(ns.flatMap((n) => (n.taskId ? [n.taskId] : [])))]),
      db.table<Row<'users'>>('users').bulkGet([...new Set(ns.map((n) => n.actorId))]),
    ]);
    const statusPair = (n: Row<'notifications'>) =>
      (n.changes?.statusId as [string, string] | undefined) ?? [];
    const [comments, statuses] = await Promise.all([
      db
        .table<Row<'comments'>>('comments')
        .bulkGet([...new Set(ns.flatMap((n) => (n.commentId ? [n.commentId] : [])))]),
      db.table<Row<'statuses'>>('statuses').bulkGet([...new Set(ns.flatMap(statusPair))]),
    ]);
    const comment = new Map(comments.flatMap((c) => (c ? [[c.id, c.body] as const] : [])));
    const status = new Map(statuses.flatMap((s) => (s ? [[s.id, s] as const] : [])));
    const projects = await db
      .table<Row<'projects'>>('projects')
      .bulkGet([...new Set(tasks.flatMap((t) => (t ? [t.projectId] : [])))]);
    const chIds = [...new Set(ns.flatMap((n) => CHANNEL.exec(n.url ?? '')?.[1] ?? []))];
    const channels =
      chIds.length && db.tables.some((x) => x.name === 'chatChannels')
        ? await db.table<{ id: string; projectId?: string | null }>('chatChannels').bulkGet(chIds)
        : [];
    const chProject = new Map(channels.flatMap((c) => (c ? [[c.id, c.projectId ?? null]] : [])));
    // document page level (doc_mention) — its project
    const pageIds = [...new Set(ns.flatMap((n) => PAGE.exec(n.url ?? '')?.[1] ?? []))];
    const pages =
      pageIds.length && db.tables.some((x) => x.name === 'docsPages')
        ? await db.table<{ id: string; projectId?: string | null }>('docsPages').bulkGet(pageIds)
        : [];
    for (const p of pages) if (p) chProject.set(p.id, p.projectId ?? null);
    const task = new Map(tasks.flatMap((t) => (t ? [[t.id, t] as const] : [])));
    const user = new Map(users.flatMap((u) => (u ? [[u.id, u.name] as const] : [])));
    const proj = new Map(projects.flatMap((p) => (p ? [[p.id, p.key] as const] : [])));
    return ns
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((n) => {
        const t = n.taskId ? task.get(n.taskId) : undefined;
        return {
          ...n,
          actorName: user.get(n.actorId) ?? '?',
          taskKey: t ? `${proj.get(t.projectId) ?? '?'}-${t.number ?? '…'}` : null,
          // notification without a task (chat_*): body is used instead of the title
          taskTitle: t?.title ?? (n.taskId ? '' : (n.body ?? '')),
          projectId:
            t?.projectId ??
            chProject.get((CHANNEL.exec(n.url ?? '') ?? PAGE.exec(n.url ?? ''))?.[1] ?? '') ??
            null,
          status: pair(statusPair(n).map((id) => status.get(id))),
          comment: n.commentId
            ? docText(comment.get(n.commentId)).replace(/\s+/g, ' ').trim().slice(0, 200) || null
            : null,
        };
      });
  });

// both statuses still exist locally — otherwise show only the notification phrase
const pair = (s: (Row<'statuses'> | undefined)[]): [Status, Status] | null =>
  s.length === 2 && s[0] && s[1] ? [s[0], s[1]] : null;

/** Inbox cards, as in ClickUp: notifications of one task together; order — newest first. */
export function groupByTask(items: InboxItem[]): InboxItem[][] {
  const m = new Map<string, InboxItem[]>();
  for (const n of items) {
    const k = n.taskId ?? n.id;
    const g = m.get(k);
    if (g) g.push(n);
    else m.set(k, [n]);
  }
  return [...m.values()];
}

/** Count of unread, not snoozed notifications (for the bell and badges). */
export function useUnread() {
  const rows = useQuery(() => db.table<Row<'notifications'>>('notifications').toArray());
  return computed(
    () =>
      (rows.value ?? []).filter((n) => !n.readAt && !(snoozed.value[n.id] && isSnoozed(n.id)))
        .length,
  );
}

export type MyTask = Row<'tasks'> & { key: string; project: string; status: Row<'statuses'> };

/** "My work": assigned to me, created by me, watched */
export type WorkKind = 'assigned' | 'created' | 'watched';

async function workTasks(kind: WorkKind, uid: string): Promise<Row<'tasks'>[]> {
  const tasks = db.table<Row<'tasks'>>('tasks');
  if (kind === 'created') return tasks.filter((t) => t.createdBy === uid).toArray();
  const links = await db
    .table<{ taskId: string }>(kind === 'assigned' ? 'taskAssignees' : 'taskWatchers')
    .where('userId')
    .equals(uid)
    .toArray();
  const ids = new Set(links.map((a) => a.taskId));
  // assigned: also a task with my open comment or checklist item (PLNRAPP-140)
  if (kind === 'assigned') for (const id of await forMeTaskIds(uid)) ids.add(id);
  return (await tasks.bulkGet([...ids])).filter((t): t is Row<'tasks'> => !!t);
}

export const useMyTasks = (
  userId: () => string | undefined,
  kind: () => WorkKind = () => 'assigned',
) =>
  useQuery(async (): Promise<MyTask[]> => {
    const uid = userId();
    if (!uid) return [];
    const tasks = await workTasks(kind(), uid);
    const [statuses, projects] = await Promise.all([
      db.table<Row<'statuses'>>('statuses').bulkGet([...new Set(tasks.map((t) => t.statusId))]),
      db.table<Row<'projects'>>('projects').bulkGet([...new Set(tasks.map((t) => t.projectId))]),
    ]);
    const st = new Map(statuses.flatMap((s) => (s ? [[s.id, s] as const] : [])));
    const pr = new Map(projects.flatMap((p) => (p ? [[p.id, p] as const] : [])));
    return tasks.flatMap((t) => {
      const status = st.get(t.statusId);
      const p = pr.get(t.projectId);
      if (!status || status.category === 'done' || status.category === 'cancelled') return [];
      return [{ ...t, status, project: p?.name ?? '', key: `${p?.key ?? '?'}-${t.number ?? '…'}` }];
    });
  });

/** Notification in a group: its own level and nested (own — only its own level, for the menu branch badge). */
export function inGroup(
  n: InboxItem,
  g: { level: 'workspace' | 'space' | 'project'; spaceId: string; projectId: string | null },
  own = false,
): boolean {
  if (g.level === 'project') return n.projectId === g.projectId;
  if (g.level === 'space') return n.spaceId === g.spaceId && (!own || !n.projectId);
  return !own || n.spaceId === g.spaceId || n.spaceId === null;
}

/** Unread, not snoozed — by groups (the "Inbox" branch in the menu). */
export function useUnreadItems() {
  const rows = useNotifications();
  return computed(() =>
    (rows.value ?? []).filter((n) => !n.readAt && !(snoozed.value[n.id] && isSnoozed(n.id))),
  );
}

export type AssignedComment = (
  (Row<'comments'> & { kind: 'comment' }) | (Row<'checklistItems'> & { kind: 'check' })
) & { key: string; title: string; projectId: string; closed: boolean };

/** "Comments for me": comments and checklist items (PLNRAPP-140) assigned to me, mixed, with their task */
export const useAssignedComments = (userId: () => string | undefined) =>
  useQuery(async (): Promise<AssignedComment[]> => {
    const uid = userId();
    if (!uid) return [];
    const [cs, is] = await Promise.all([
      db
        .table<Row<'comments'>>('comments')
        .filter((c) => c.assigneeId === uid)
        .toArray(),
      db
        .table<Row<'checklistItems'>>('checklistItems')
        .filter((i) => i.assigneeId === uid)
        .toArray(),
    ]);
    const rows = [
      ...cs.map((c) => ({ ...c, kind: 'comment' as const, closed: !!c.resolvedAt })),
      ...is.map((i) => ({ ...i, kind: 'check' as const, closed: i.done })),
    ];
    const tasks = await db
      .table<Row<'tasks'>>('tasks')
      .bulkGet([...new Set(rows.map((c) => c.taskId))]);
    const task = new Map(tasks.flatMap((t) => (t ? [[t.id, t] as const] : [])));
    const projects = await db
      .table<Row<'projects'>>('projects')
      .bulkGet([...new Set(tasks.flatMap((t) => (t ? [t.projectId] : [])))]);
    const key = new Map(projects.flatMap((p) => (p ? [[p.id, p.key] as const] : [])));
    return rows
      .flatMap((c) => {
        const t = task.get(c.taskId);
        return t
          ? [
              {
                ...c,
                title: t.title,
                projectId: t.projectId,
                key: `${key.get(t.projectId) ?? '?'}-${t.number ?? '…'}`,
              },
            ]
          : [];
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  });
