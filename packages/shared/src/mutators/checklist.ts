import { z } from 'zod';
import { CHECKLIST_MAX_INDENT, MutatorError, defineMutator } from '../contract/index.js';
import { changes, need, rank, uuid } from './util.js';
import { checkAssignee } from './comments.js';

const text = z.string().min(1).max(500);
const indent = z.number().int().min(0).max(CHECKLIST_MAX_INDENT);

export const checklistMutators = [
  defineMutator({
    name: 'checklist.add',
    args: z.object({ id: uuid, taskId: uuid, text, rank, indent: indent.optional() }),
    async run(tx, a, ctx) {
      const t = await need(tx, 'tasks', a.taskId);
      await tx.put('checklistItems', {
        ...a,
        spaceId: t.spaceId,
        done: false,
        assigneeId: null,
        linkedTaskId: null,
        indent: a.indent ?? 0,
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
      linkedTaskId: uuid.nullable().optional(),
      indent: indent.optional(),
    }),
    async run(tx, a, ctx) {
      const item = await need(tx, 'checklistItems', a.id);
      // assigned item (PLNRAPP-140): to a space member, as a comment
      if (a.assigneeId) await checkAssignee(tx, item.spaceId, a.assigneeId);
      // the item turned into a task (PLNRAPP-142): a task of the same space
      if (a.linkedTaskId && (await need(tx, 'tasks', a.linkedTaskId)).spaceId !== item.spaceId)
        throw new MutatorError('invalid_args', 'linkedTaskId: task of another space');
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
