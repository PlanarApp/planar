import { generateKeyBetween } from 'fractional-indexing';
import { z } from 'zod';
import { uuidv7 } from '@planar/shared';
import { activityOf, checklist, findOwned, findTask, lastRank } from './tasks.service.js';
import type { ExtArea, ExtOp } from './types.js';

const task = z.string().min(1).describe('uuid или ключ задачи, например ABC-123');
const id = z.uuid();
const item = z.object({
  text: z.string().min(1).max(500),
  indent: z.number().int().min(0).optional(),
});

const tasksOf = (d: Parameters<ExtOp['run']>[0], u: string, refs: string[]) =>
  Promise.all(refs.map((r) => findTask(d, u, r)));

/** a task mutation as the user; answers `{ id }` of the task */
const onTask =
  (name: string, args: (id: string) => object): ExtOp['run'] =>
  async (d, u, i, tok) => {
    const t = await findTask(d, u, (i as { task: string }).task);
    await d.run(u, [{ name, args: args(t.id) }], tok);
    return { id: t.id };
  };

const ops: ExtOp[] = [
  {
    tool: 'delete_task',
    description: 'Удалить задачу насовсем (нужна роль admin проекта; обратимо только архивом)',
    method: 'delete',
    path: '/api/v1/tasks/{task}',
    shape: { task },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, tok) => {
      const t = await findTask(d, u, (i as { task: string }).task);
      await d.run(u, [{ name: 'task.delete', args: { id: t.id } }], tok);
    },
  },
  {
    tool: 'archive_task',
    description: 'Отправить задачу с подзадачами в архив',
    method: 'post',
    path: '/api/v1/tasks/{task}/archive',
    shape: { task },
    write: true,
    run: onTask('task.archive', (id) => ({ id })),
  },
  {
    tool: 'restore_task',
    description: 'Вернуть задачу из архива (нужна роль admin проекта)',
    method: 'post',
    path: '/api/v1/tasks/{task}/restore',
    shape: { task },
    write: true,
    run: onTask('task.restore', (id) => ({ id })),
  },
  {
    tool: 'merge_tasks',
    description:
      'Слить задачи в целевую: подзадачи, комментарии и связи переходят к ней, исходные отменяются и связываются с ней',
    method: 'post',
    path: '/api/v1/tasks/merge',
    shape: { taskIds: z.array(task).min(1).max(100), target: task },
    write: true,
    danger: 'bulk',
    run: async (d, u, i, tok) => {
      const a = i as { taskIds: string[]; target: string };
      const target = await findTask(d, u, a.target);
      const from = await tasksOf(d, u, a.taskIds);
      await d.run(
        u,
        [
          {
            name: 'task.merge',
            args: {
              ids: from.map((t) => t.id),
              targetId: target.id,
              linkIds: from.map(() => uuidv7()),
            },
          },
        ],
        tok,
      );
      return { id: target.id };
    },
  },
  {
    tool: 'watch_task',
    description: 'Подписаться на задачу (уведомления об изменениях)',
    method: 'post',
    path: '/api/v1/tasks/{task}/watch',
    shape: { task },
    write: true,
    run: onTask('task.watch', (taskId) => ({ id: uuidv7(), taskId })),
  },
  {
    tool: 'unwatch_task',
    description: 'Отписаться от задачи',
    method: 'post',
    path: '/api/v1/tasks/{task}/unwatch',
    shape: { task },
    write: true,
    run: onTask('task.unwatch', (taskId) => ({ taskId })),
  },
  {
    tool: 'list_checklist',
    description: 'Чек-лист задачи по порядку',
    method: 'get',
    path: '/api/v1/tasks/{task}/checklist',
    shape: { task },
    write: false,
    run: async (d, u, i) => checklist(d, (await findTask(d, u, (i as { task: string }).task)).id),
  },
  {
    tool: 'add_checklist_item',
    description: 'Добавить пункт в конец чек-листа задачи',
    method: 'post',
    path: '/api/v1/tasks/{task}/checklist',
    shape: { task, ...item.shape },
    write: true,
    status: 201,
    run: async (d, u, i, tok) => {
      const a = i as { task: string } & z.infer<typeof item>;
      const t = await findTask(d, u, a.task);
      const itemId = uuidv7();
      await d.run(
        u,
        [
          {
            name: 'checklist.add',
            args: {
              id: itemId,
              taskId: t.id,
              text: a.text,
              rank: generateKeyBetween(await lastRank(d, t.id), null),
              indent: a.indent,
            },
          },
        ],
        tok,
      );
      return (await checklist(d, t.id)).find((x) => x.id === itemId);
    },
  },
  {
    tool: 'update_checklist_item',
    description: 'Изменить пункт чек-листа: текст, отметку, исполнителя, отступ',
    method: 'patch',
    path: '/api/v1/checklist/{id}',
    shape: {
      id,
      text: z.string().min(1).max(500).optional(),
      done: z.boolean().optional(),
      assigneeId: id.nullable().optional(),
      indent: z.number().int().min(0).optional(),
    },
    write: true,
    run: async (d, u, i, tok) => {
      const a = i as { id: string };
      const t = await findOwned(d, u, 'checklist', a.id);
      await d.run(u, [{ name: 'checklist.update', args: a }], tok);
      return (await checklist(d, t.id)).find((x) => x.id === a.id);
    },
  },
  {
    tool: 'delete_checklist_item',
    description: 'Удалить пункт чек-листа',
    method: 'delete',
    path: '/api/v1/checklist/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, tok) => {
      const a = i as { id: string };
      await findOwned(d, u, 'checklist', a.id);
      await d.run(u, [{ name: 'checklist.delete', args: { id: a.id } }], tok);
    },
  },
  {
    tool: 'toggle_reaction',
    description: 'Поставить реакцию на комментарий или снять свою (повторный вызов снимает)',
    method: 'post',
    path: '/api/v1/comments/{id}/reactions',
    shape: { id, emoji: z.string().min(1).max(32) },
    write: true,
    run: async (d, u, i, tok) => {
      const a = i as { id: string; emoji: string };
      await findOwned(d, u, 'comment', a.id);
      await d.run(
        u,
        [{ name: 'reaction.toggle', args: { id: uuidv7(), commentId: a.id, emoji: a.emoji } }],
        tok,
      );
      return { commentId: a.id, emoji: a.emoji };
    },
  },
  {
    tool: 'delete_comment',
    description: 'Удалить свой комментарий вместе с ответами, реакциями и вложениями',
    method: 'delete',
    path: '/api/v1/comments/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, tok) => {
      const a = i as { id: string };
      await findOwned(d, u, 'comment', a.id);
      await d.run(u, [{ name: 'comment.delete', args: { id: a.id } }], tok);
    },
  },
  {
    tool: 'task_activity',
    description: 'Лента активности задачи: создание, изменения, исполнители, метки, комментарии',
    method: 'get',
    path: '/api/v1/tasks/{task}/activity',
    shape: { task, limit: z.coerce.number().int().min(1).max(200).default(50) },
    write: false,
    run: async (d, u, i) => {
      const a = i as { task: string; limit: number };
      return activityOf(d, (await findTask(d, u, a.task)).id, a.limit);
    },
  },
];

export const area: ExtArea = { name: 'tasks', ops };
