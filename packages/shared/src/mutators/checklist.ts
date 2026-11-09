import { z } from 'zod';
import { defineMutator } from '../contract/index.js';
import { changes, need, rank, uuid } from './util.js';
import { checkAssignee } from './comments.js';

const text = z.string().min(1).max(500);

export const checklistMutators = [
  defineMutator({
    name: 'checklist.add',
    args: z.object({ id: uuid, taskId: uuid, text, rank }),
    async run(tx, a, ctx) {
      const t = await need(tx, 'tasks', a.taskId);
      await tx.put('checklistItems', {
        ...a,
        spaceId: t.spaceId,
        done: false,
        assigneeId: null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'checklist.update',
    args: z.object({
      id: uuid,
      text: text.optional(),
      done: z.boolean().optional(),
      rank: rank.optional(),
      assigneeId: uuid.nullable().optional(),
    }),
    async run(tx, a, ctx) {
      const item = await need(tx, 'checklistItems', a.id);
      // assigned item (PLNRAPP-140): to a space member, as a comment
      if (a.assigneeId) await checkAssignee(tx, item.spaceId, a.assigneeId);
      await tx.patch('checklistItems', a.id, changes('checklistItems', a, ctx));
    },
  }),
  defineMutator({
    name: 'checklist.delete',
    args: z.object({ id: uuid }),
    async run(tx, a) {
      await tx.del('checklistItems', a.id);
    },
  }),
];
