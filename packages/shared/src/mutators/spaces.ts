import { z } from 'zod';
import { MutatorError, defineMutator } from '../contract/index.js';
import { changes, color, delWhere, name, need, rank, uuid } from './util.js';
import { deleteTask } from './tasks.js';

export const spaceMutators = [
  defineMutator({
    name: 'space.create',
    args: z.object({
      id: uuid,
      name,
      rank,
      memberId: uuid,
    }),
    async run(tx, a, ctx) {
      const t = { createdAt: ctx.now, updatedAt: ctx.now };
      await tx.put('spaces', {
        id: a.id,
        name: a.name,
        description: null,
        color: null,
        icon: null,
        rank: a.rank,
        createdBy: ctx.userId,
        ...t,
      });
      await tx.put('spaceMembers', {
        id: a.memberId,
        spaceId: a.id,
        userId: ctx.userId,
        role: 'admin',
        ...t,
      });
    },
  }),
  defineMutator({
    name: 'space.update',
    args: z.object({
      id: uuid,
      name: name.optional(),
      description: z.string().nullable().optional(),
      color: color.nullable().optional(),
      icon: z.string().nullable().optional(),
      rank: rank.optional(),
    }),
    async run(tx, a, ctx) {
      await need(tx, 'spaces', a.id);
      await tx.patch('spaces', a.id, changes('spaces', a, ctx));
    },
  }),
  defineMutator({
    name: 'space.delete',
    // withContent — also delete projects with tasks (bulk delete in settings); without it — only empty ones
    args: z.object({ id: uuid, withContent: z.boolean().optional() }),
    async run(tx, a) {
      await need(tx, 'spaces', a.id);
      if ((await tx.get('settings', 'root_space'))?.value === a.id)
        throw new MutatorError('invalid_args', 'корневое пространство — это Воркспейс');
      const projects = await tx.scan('projects', { index: 'spaceId', eq: a.id });
      if (projects.length && !a.withContent) throw new MutatorError('conflict', 'есть проекты');
      for (const p of projects) {
        const tasks = await tx.scan('tasks', { index: 'projectId', eq: p.id });
        // roots take subtasks; the remaining ones (parent in another project) — one by one
        for (const t of tasks.filter((x) => !x.parentId)) await deleteTask(tx, t.id);
        for (const t of await tx.scan('tasks', { index: 'projectId', eq: p.id }))
          await deleteTask(tx, t.id);
        await delWhere(tx, 'fieldDefs', 'projectId', p.id);
        await delWhere(tx, 'projectMembers', 'projectId', p.id);
        await tx.del('projects', p.id);
      }
      for (const e of ['statuses', 'labels', 'savedViews', 'spaceMembers'] as const)
        await delWhere(tx, e, 'spaceId', a.id);
      await tx.del('spaces', a.id);
    },
  }),
];
