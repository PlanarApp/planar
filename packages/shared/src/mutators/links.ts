import { z } from 'zod';
import { MutatorError, defineMutator, entitySchemas } from '../contract/index.js';
import { bad, uuid } from './util.js';

export const linkMutators = [
  defineMutator({
    name: 'link.create',
    args: z.object({
      id: uuid,
      taskId: uuid,
      targetId: uuid,
      kind: entitySchemas.taskLinks.shape.kind,
    }),
    async run(tx, a, ctx) {
      if (a.taskId === a.targetId) throw bad('связь задачи с самой собой');
      const t = await tx.get('tasks', a.taskId);
      const o = await tx.get('tasks', a.targetId);
      if (!t || !o) throw bad('нет задачи');
      if (t.spaceId !== o.spaceId) throw bad('задачи разных пространств');
      const pair = [
        ...(await tx.scan('taskLinks', { index: 'taskId', eq: t.id })),
        ...(await tx.scan('taskLinks', { index: 'targetId', eq: t.id })),
      ];
      if (pair.some((l) => l.taskId === o.id || l.targetId === o.id))
        throw new MutatorError('conflict', 'пара уже связана');
      await tx.put('taskLinks', {
        ...a,
        spaceId: t.spaceId,
        createdBy: ctx.userId,
        createdAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'link.delete',
    args: z.object({ id: uuid }),
    async run(tx, a) {
      if (await tx.get('taskLinks', a.id)) await tx.del('taskLinks', a.id);
    },
  }),
];
