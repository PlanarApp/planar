import { z } from 'zod';
import { MutatorError, defineMutator } from '../contract/index.js';
import { changes, color, delWhere, name, need, rank, uuid } from './util.js';

const CATEGORIES = [
  ['backlog', 'Backlog', '#94a3b8'],
  ['todo', 'Todo', '#64748b'],
  ['in_progress', 'In Progress', '#3b82f6'],
  ['done', 'Done', '#22c55e'],
  ['cancelled', 'Cancelled', '#ef4444'],
] as const;

const customName = (v?: string) => (v && v.trim().length <= 64 ? v.trim() || undefined : undefined);

export const spaceMutators = [
  defineMutator({
    name: 'space.create',
    args: z.object({
      id: uuid,
      name,
      rank,
      memberId: uuid,
      statusIds: z.array(uuid).length(5),
      statusNames: z
        .partialRecord(z.enum(CATEGORIES.map((c) => c[0]) as [string, ...string[]]), z.string())
        .optional(),
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
      for (const [i, [category, title, c]] of CATEGORIES.entries())
        await tx.put('statuses', {
          id: a.statusIds[i],
          spaceId: a.id,
          name: customName(a.statusNames?.[category]) ?? title,
          category,
          color: c,
          rank: `a${i}`,
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
    args: z.object({ id: uuid }),
    async run(tx, a) {
      await need(tx, 'spaces', a.id);
      if ((await tx.scan('projects', { index: 'spaceId', eq: a.id })).length)
        throw new MutatorError('conflict', 'есть проекты');
      for (const e of ['statuses', 'labels', 'savedViews', 'spaceMembers'] as const)
        await delWhere(tx, e, 'spaceId', a.id);
      await tx.del('spaces', a.id);
    },
  }),
];
