import { z } from 'zod';
import { MutatorError, defineMutator } from '../contract/index.js';
import { bad, changes, color, completedAt, name, need, rank, uuid } from './util.js';

const category = z.enum(['backlog', 'todo', 'in_progress', 'done', 'cancelled']);

export const statusMutators = [
  defineMutator({
    name: 'status.create',
    args: z.object({ id: uuid, spaceId: uuid, name, category, color: z.string(), rank }),
    async run(tx, a, ctx) {
      await need(tx, 'spaces', a.spaceId);
      await tx.put('statuses', { ...a, createdAt: ctx.now, updatedAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'status.update',
    args: z.object({
      id: uuid,
      name: name.optional(),
      category: category.optional(),
      color: color.optional(),
      rank: rank.optional(),
    }),
    async run(tx, a, ctx) {
      const st = await need(tx, 'statuses', a.id);
      await tx.patch('statuses', a.id, changes('statuses', a, ctx));
      if (a.category && a.category !== st.category)
        for (const t of await tx.scan('tasks', { index: 'statusId', eq: st.id }))
          await tx.patch('tasks', t.id, {
            completedAt: completedAt(a.category, t.completedAt, ctx),
            updatedAt: ctx.now,
          });
    },
  }),
  defineMutator({
    name: 'status.delete',
    args: z.object({ id: uuid, replaceWith: uuid }),
    async run(tx, a, ctx) {
      const st = await need(tx, 'statuses', a.id);
      if ((await tx.scan('statuses', { index: 'spaceId', eq: st.spaceId })).length <= 1)
        throw new MutatorError('conflict', 'последний статус');
      const rep = await need(tx, 'statuses', a.replaceWith);
      if (rep.id === st.id) throw bad('replaceWith совпадает со статусом');
      if (rep.spaceId !== st.spaceId) throw bad('replaceWith другого пространства');
      for (const t of await tx.scan('tasks', { index: 'statusId', eq: st.id }))
        await tx.patch('tasks', t.id, {
          statusId: rep.id,
          completedAt: completedAt(rep.category, t.completedAt, ctx),
          updatedAt: ctx.now,
        });
      await tx.del('statuses', a.id);
    },
  }),
];
