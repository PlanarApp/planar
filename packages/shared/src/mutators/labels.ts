import { z } from 'zod';
import { defineMutator } from '../contract/index.js';
import { changes, color, delWhere, name, need, uuid } from './util.js';

export const labelMutators = [
  defineMutator({
    name: 'label.create',
    args: z.object({ id: uuid, projectId: uuid, name, color }),
    async run(tx, a, ctx) {
      const p = await need(tx, 'projects', a.projectId);
      await tx.put('labels', { ...a, spaceId: p.spaceId, createdAt: ctx.now, updatedAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'label.update',
    args: z.object({ id: uuid, name: name.optional(), color: color.optional() }),
    async run(tx, a, ctx) {
      await need(tx, 'labels', a.id);
      await tx.patch('labels', a.id, changes('labels', a, ctx));
    },
  }),
  defineMutator({
    name: 'label.delete',
    args: z.object({ id: uuid }),
    async run(tx, a) {
      await need(tx, 'labels', a.id);
      await delWhere(tx, 'taskLabels', 'labelId', a.id);
      await tx.del('labels', a.id);
    },
  }),
];
