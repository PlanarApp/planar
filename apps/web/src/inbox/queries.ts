import { computed } from 'vue';
import type { Row } from '@planar/shared';
import { db, useQuery } from '../sync';
import { isSnoozed, snoozed } from './snooze';

export type InboxItem = Row<'notifications'> & {
  actorName: string;
  taskKey: string | null;
  taskTitle: string;
  /** уровень группы: проект задачи или канала; null — пространство (spaceId) или личный диалог */
  projectId: string | null;
};

const CHANNEL = /^\/m\/chat\/c\/([0-9a-f-]{36})/;

export const useNotifications = () =>
  useQuery(async (): Promise<InboxItem[]> => {
    const ns = await db.table<Row<'notifications'>>('notifications').toArray();
    const [tasks, users] = await Promise.all([
      db
        .table<Row<'tasks'>>('tasks')
        .bulkGet([...new Set(ns.flatMap((n) => (n.taskId ? [n.taskId] : [])))]),
      db.table<Row<'users'>>('users').bulkGet([...new Set(ns.map((n) => n.actorId))]),
    ]);
    const projects = await db
      .table<Row<'projects'>>('projects')
      .bulkGet([...new Set(tasks.flatMap((t) => (t ? [t.projectId] : [])))]);
    const chIds = [...new Set(ns.flatMap((n) => CHANNEL.exec(n.url ?? '')?.[1] ?? []))];
    const channels =
      chIds.length && db.tables.some((x) => x.name === 'chatChannels')
        ? await db.table<{ id: string; projectId?: string | null }>('chatChannels').bulkGet(chIds)
        : [];
    const chProject = new Map(channels.flatMap((c) => (c ? [[c.id, c.projectId ?? null]] : [])));
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
          // уведомление без задачи (chat_*): вместо названия — body
          taskTitle: t?.title ?? (n.taskId ? '' : (n.body ?? '')),
          projectId: t?.projectId ?? chProject.get(CHANNEL.exec(n.url ?? '')?.[1] ?? '') ?? null,
        };
      });
  });

/** Число непрочитанных, не отложенных (для колокольчика и бейджей). */
export function useUnread() {
  const rows = useQuery(() => db.table<Row<'notifications'>>('notifications').toArray());
  return computed(
    () =>
      (rows.value ?? []).filter((n) => !n.readAt && !(snoozed.value[n.id] && isSnoozed(n.id)))
        .length,
  );
}

export type MyTask = Row<'tasks'> & { key: string; project: string; status: Row<'statuses'> };

export const useMyTasks = (userId: () => string | undefined) =>
  useQuery(async (): Promise<MyTask[]> => {
    const uid = userId();
    if (!uid) return [];
    const as = await db
      .table<Row<'taskAssignees'>>('taskAssignees')
      .where('userId')
      .equals(uid)
      .toArray();
    const tasks = (await db.table<Row<'tasks'>>('tasks').bulkGet(as.map((a) => a.taskId))).filter(
      (t): t is Row<'tasks'> => !!t,
    );
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

/** Уведомление в группе: свой уровень и вложенные (own — только свой уровень, для бейджа ветки меню). */
export function inGroup(
  n: InboxItem,
  g: { level: 'workspace' | 'space' | 'project'; spaceId: string; projectId: string | null },
  own = false,
): boolean {
  if (g.level === 'project') return n.projectId === g.projectId;
  if (g.level === 'space') return n.spaceId === g.spaceId && (!own || !n.projectId);
  return !own || n.spaceId === g.spaceId || n.spaceId === null;
}

/** Непрочитанные, не отложенные — по группам (ветка «Входящие» в меню). */
export function useUnreadItems() {
  const rows = useNotifications();
  return computed(() =>
    (rows.value ?? []).filter((n) => !n.readAt && !(snoozed.value[n.id] && isSnoozed(n.id))),
  );
}
