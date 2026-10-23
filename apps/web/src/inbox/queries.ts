import { computed } from 'vue';
import type { Row } from '@planar/shared';
import { db, useQuery } from '../sync';
import { isSnoozed, snoozed } from './snooze';

export type InboxItem = Row<'notifications'> & {
  actorName: string;
  taskKey: string | null;
  taskTitle: string;
};

export const useNotifications = () =>
  useQuery(async (): Promise<InboxItem[]> => {
    const ns = await db.table<Row<'notifications'>>('notifications').toArray();
    const [tasks, users] = await Promise.all([
      db.table<Row<'tasks'>>('tasks').bulkGet([...new Set(ns.map((n) => n.taskId))]),
      db.table<Row<'users'>>('users').bulkGet([...new Set(ns.map((n) => n.actorId))]),
    ]);
    const projects = await db
      .table<Row<'projects'>>('projects')
      .bulkGet([...new Set(tasks.flatMap((t) => (t ? [t.projectId] : [])))]);
    const task = new Map(tasks.flatMap((t) => (t ? [[t.id, t] as const] : [])));
    const user = new Map(users.flatMap((u) => (u ? [[u.id, u.name] as const] : [])));
    const proj = new Map(projects.flatMap((p) => (p ? [[p.id, p.key] as const] : [])));
    return ns
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((n) => {
        const t = task.get(n.taskId);
        return {
          ...n,
          actorName: user.get(n.actorId) ?? '?',
          taskKey: t ? `${proj.get(t.projectId) ?? '?'}-${t.number ?? '…'}` : null,
          taskTitle: t?.title ?? '',
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
