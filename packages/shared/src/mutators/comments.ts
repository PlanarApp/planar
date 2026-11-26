import { z } from 'zod';
import { MutatorError, defineMutator, type Tx } from '../contract/index.js';
import { bad, delWhere, doc, need, roleInProject, uuid } from './util.js';
import { extractMentions } from './text.js';

/** can be assigned to a member of the task's project (PJ-11), not a guest (comments, checklist items) */
export async function checkAssignee(
  tx: Tx,
  spaceId: string,
  projectId: string | null,
  userId: string,
) {
  const r = await roleInProject(tx, spaceId, projectId, userId);
  if (!r || r === 'guest') throw bad('исполнитель — не участник пространства');
}

/** a file already in storage (POST /files) attached to a comment (PLNRAPP-372) */
const fileArgs = z.object({
  id: uuid,
  fileSha256: z.string().min(1),
  name: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().min(0),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
});
type FileArgs = z.infer<typeof fileArgs>;
const putFiles = async (
  tx: Tx,
  c: { id: string; spaceId: string; taskId: string },
  files: FileArgs[] | undefined,
  ctx: { userId: string; now: string },
) => {
  for (const f of files ?? [])
    await tx.put('attachments', {
      ...f,
      spaceId: c.spaceId,
      taskId: c.taskId,
      commentId: c.id,
      width: f.width ?? null,
      height: f.height ?? null,
      uploadedBy: ctx.userId,
      createdAt: ctx.now,
    });
};

export const commentMutators = [
  defineMutator({
    name: 'comment.create',
    args: z.object({
      id: uuid,
      taskId: uuid,
      body: doc,
      parentId: uuid.nullable().optional(),
      assigneeId: uuid.nullable().optional(),
      /** PLNRAPP-372: files of the comment — in the same transaction (the notification lists them) */
      attachments: z.array(fileArgs).max(100).optional(),
    }),
    async run(tx, a, ctx) {
      const t = await need(tx, 'tasks', a.taskId);
      if (a.parentId) {
        const p = await need(tx, 'comments', a.parentId);
        // any depth (PLANARAPP-45): a reply to any comment of this task
        if (p.taskId !== t.id) throw bad('ответ — только на комментарий этой задачи');
      }
      if (a.assigneeId) await checkAssignee(tx, t.spaceId, t.projectId, a.assigneeId);
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
      await putFiles(tx, { id: a.id, spaceId: t.spaceId, taskId: t.id }, a.attachments, ctx);
    },
  }),
  defineMutator({
    name: 'comment.update',
    // PLNRAPP-372: editing adds files and removes the comment's own ones
    args: z.object({
      id: uuid,
      body: doc,
      attachments: z.array(fileArgs).max(100).optional(),
      removeAttachments: z.array(uuid).max(100).optional(),
    }),
    async run(tx, a, ctx) {
      const c = await need(tx, 'comments', a.id);
      if (c.authorId !== ctx.userId) throw new MutatorError('forbidden', 'не автор');
      await tx.patch('comments', a.id, {
        body: a.body,
        mentions: extractMentions(a.body),
        editedAt: ctx.now,
        updatedAt: ctx.now,
      });
      for (const id of a.removeAttachments ?? []) {
        const x = await tx.get('attachments', id);
        if (x && x.commentId !== c.id) throw bad('вложение другого комментария');
        if (x) await tx.del('attachments', id);
      }
      await putFiles(tx, c, a.attachments, ctx);
    },
  }),
  defineMutator({
    name: 'comment.delete',
    args: z.object({ id: uuid }),
    async run(tx, a, ctx) {
      const c = await need(tx, 'comments', a.id);
      if (c.authorId !== ctx.userId) throw new MutatorError('forbidden', 'не автор');
      // deleting a comment takes its whole subtree of replies, their reactions and attachments
      const all = await tx.scan('comments', { index: 'taskId', eq: c.taskId });
      const subtree = [c];
      for (let i = 0; i < subtree.length; i++)
        subtree.push(...all.filter((r) => r.parentId === subtree[i]!.id));
      for (const x of subtree.reverse()) {
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
      // any comment of a thread, replies too (PLNRAPP-135)
      const c = await need(tx, 'comments', a.id);
      // the role in the task's project (PJ-11): a guest of a `custom` project is a guest here too
      const projectId = (await tx.get('tasks', c.taskId))?.projectId ?? null;
      const r = await roleInProject(tx, c.spaceId, projectId, ctx.userId);
      if (!r || r === 'guest') throw new MutatorError('forbidden', 'нужна роль member');
      if (a.assigneeId) await checkAssignee(tx, c.spaceId, projectId, a.assigneeId);
      // new assignment — reopened
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
      const c = await need(tx, 'comments', a.id);
      if (!c.assigneeId) throw bad('комментарий не назначен');
      const may =
        ctx.userId === c.assigneeId ||
        ctx.userId === c.authorId ||
        (await roleInProject(tx, c.spaceId, null, ctx.userId)) === 'admin';
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
    async run(tx, a, ctx) {
      // a comment's file — only its author or the uploader (PLNRAPP-372)
      const x = await tx.get('attachments', a.id);
      const c = x?.commentId ? await tx.get('comments', x.commentId) : null;
      if (c && c.authorId !== ctx.userId && x!.uploadedBy !== ctx.userId)
        throw new MutatorError('forbidden', 'не автор');
      await tx.del('attachments', a.id);
    },
  }),
];
