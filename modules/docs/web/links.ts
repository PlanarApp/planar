import type { Row } from '@planar/shared';
import { db, mutate, newId, rankBetween } from '@planar/web/modules';
import type { PageRow } from './model';

export const link = (pageId: string, taskId: string) =>
  mutate('docs.link.add', { id: newId(), pageId, taskId });
export const unlink = (pageId: string, taskId: string) =>
  mutate('docs.link.remove', { pageId, taskId });

/** Новая страница в корне пространства задачи, названная как задача, и связь с ней. */
export async function createForTask(taskId: string): Promise<string | null> {
  const task = await db.table<Row<'tasks'>>('tasks').get(taskId);
  if (!task) return null;
  const last = (await db.table<PageRow>('docsPages').where('spaceId').equals(task.spaceId).toArray())
    .filter((p) => !p.parentId && !p.archivedAt)
    .map((p) => p.rank)
    .sort()
    .at(-1);
  const id = newId();
  await mutate('docs.page.create', {
    id,
    spaceId: task.spaceId,
    rank: rankBetween(last ?? null, null),
    title: task.title.slice(0, 200),
  });
  await link(id, taskId);
  return id;
}
