import { z } from 'zod';
import { MutatorError, defineMutator, type Tx } from '../contract/index.js';
import { bad, delWhere, doc, need, uuid } from './util.js';
import { extractMentions } from './text.js';

const roleIn = async (tx: Tx, spaceId: string, userId: string) =>
  (await tx.scan('spaceMembers', { index: 'spaceId', eq: spaceId })).find(
    (m) => m.userId === userId,
  )?.role;
/** назначить можно участнику пространства, не гостю */
async function checkAssignee(tx: Tx, spaceId: string, userId: string) {
  const r = await roleIn(tx, spaceId, userId);
  if (!r || r === 'guest') throw bad('исполнитель — не участник пространства');
}
/** корень треда; ответ назначить/завершить нельзя */
async function root(tx: Tx, id: string) {
  const c = await need(tx, 'comments', id);
  if (c.parentId) throw bad('только у корня треда');
  return c;
}

export const commentMutators = [
  defineMutator({
    name: 'comment.create',
    args: z.object({
      id: uuid,
      taskId: uuid,
      body: doc,
      parentId: uuid.nullable().optional(),
      assigneeId: uuid.nullable().optional(),
    }),
    async run(tx, a, ctx) {
      const t = await need(tx, 'tasks', a.taskId);
      if (a.parentId) {
        const p = await need(tx, 'comments', a.parentId);
        if (p.taskId !== t.id || p.parentId)
          throw bad('ответ — только на корень треда этой задачи');
        if (a.assigneeId) throw bad('ответ не назначается');
      }
      if (a.assigneeId) await checkAssignee(tx, t.spaceId, a.assigneeId);
      await tx.put('comments', {
        id: a.id,
        spaceId: t.spaceId,
        taskId: t.id,
        authorId: ctx.userId,
        parentId: a.parentId ?? null,
        body: a.body,
        mentions: extractMentions(a.body),
        assigneeId: a.assigneeId ?? null,
        resolvedAt: null,
        resolvedBy: null,
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
      // корень уносит тред: ответы, их реакции и вложения
      const replies = c.parentId
        ? []
        : (await tx.scan('comments', { index: 'taskId', eq: c.taskId })).filter(
            (r) => r.parentId === c.id,
          );
      for (const x of [...replies, c]) {
        await delWhere(tx, 'attachments', 'commentId', x.id);
        await delWhere(tx, 'commentReactions', 'commentId', x.id);
        await tx.del('comments', x.id);
      }
    },
  }),
  defineMutator({
    name: 'comment.assign',
    args: z.object({ id: uuid, assigneeId: uuid.nullable() }),
    async run(tx, a, ctx) {
      const c = await root(tx, a.id);
      const r = await roleIn(tx, c.spaceId, ctx.userId);
      if (!r || r === 'guest') throw new MutatorError('forbidden', 'нужна роль member');
      if (a.assigneeId) await checkAssignee(tx, c.spaceId, a.assigneeId);
      // новое назначение — снова открыт
      await tx.patch('comments', a.id, {
        assigneeId: a.assigneeId,
        resolvedAt: null,
        resolvedBy: null,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'comment.resolve',
    args: z.object({ id: uuid, resolved: z.boolean() }),
    async run(tx, a, ctx) {
      const c = await root(tx, a.id);
      if (!c.assigneeId) throw bad('комментарий не назначен');
      const may =
        ctx.userId === c.assigneeId ||
        ctx.userId === c.authorId ||
        (await roleIn(tx, c.spaceId, ctx.userId)) === 'admin';
      if (!may) throw new MutatorError('forbidden', 'завершает исполнитель, автор или admin');
      await tx.patch('comments', a.id, {
        resolvedAt: a.resolved ? ctx.now : null,
        resolvedBy: a.resolved ? ctx.userId : null,
        updatedAt: ctx.now,
      });
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
