import { z } from 'zod';
import { MutatorError, defineMutator } from '../contract/index.js';
import { bad, delWhere, doc, need, uuid } from './util.js';
import { extractMentions } from './text.js';

export const commentMutators = [
  defineMutator({
    name: 'comment.create',
    args: z.object({ id: uuid, taskId: uuid, body: doc }),
    async run(tx, a, ctx) {
      const t = await need(tx, 'tasks', a.taskId);
      await tx.put('comments', {
        id: a.id,
        spaceId: t.spaceId,
        taskId: t.id,
        authorId: ctx.userId,
        body: a.body,
        mentions: extractMentions(a.body),
        editedAt: null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'comment.update',
    args: z.object({ id: uuid, body: doc }),
    async run(tx, a, ctx) {
      const c = await need(tx, 'comments', a.id);
      if (c.authorId !== ctx.userId) throw new MutatorError('forbidden', 'не автор');
      await tx.patch('comments', a.id, {
        body: a.body,
        mentions: extractMentions(a.body),
        editedAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'comment.delete',
    args: z.object({ id: uuid }),
    async run(tx, a, ctx) {
      const c = await need(tx, 'comments', a.id);
      if (c.authorId !== ctx.userId) throw new MutatorError('forbidden', 'не автор');
      await delWhere(tx, 'attachments', 'commentId', a.id);
      await delWhere(tx, 'commentReactions', 'commentId', a.id);
      await tx.del('comments', a.id);
    },
  }),
  defineMutator({
    name: 'reaction.toggle',
    args: z.object({ id: uuid, commentId: uuid, emoji: z.string().min(1).max(32) }),
    async run(tx, a, ctx) {
      const c = await need(tx, 'comments', a.commentId);
      const mine = (await tx.scan('commentReactions', { index: 'commentId', eq: c.id })).find(
        (r) => r.userId === ctx.userId && r.emoji === a.emoji,
      );
      if (mine) return tx.del('commentReactions', mine.id);
      await tx.put('commentReactions', {
        id: a.id,
        spaceId: c.spaceId,
        commentId: c.id,
        userId: ctx.userId,
        emoji: a.emoji,
        createdAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'attachment.create',
    args: z.object({
      id: uuid,
      taskId: uuid,
      commentId: uuid.nullable().optional(),
      fileSha256: z.string().min(1),
      name: z.string().min(1),
      mime: z.string().min(1),
      size: z.number().int().min(0),
      width: z.number().int().nullable().optional(),
      height: z.number().int().nullable().optional(),
    }),
    async run(tx, a, ctx) {
      const t = await need(tx, 'tasks', a.taskId);
      if (a.commentId && (await need(tx, 'comments', a.commentId)).taskId !== t.id)
        throw bad('commentId другой задачи');
      await tx.put('attachments', {
        ...a,
        spaceId: t.spaceId,
        commentId: a.commentId ?? null,
        width: a.width ?? null,
        height: a.height ?? null,
        uploadedBy: ctx.userId,
        createdAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'attachment.delete',
    args: z.object({ id: uuid }),
    async run(tx, a) {
      await tx.del('attachments', a.id);
    },
  }),
];
