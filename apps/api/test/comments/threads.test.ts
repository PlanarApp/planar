import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { doc, newDb, taskArgs, world } from '../sync/helpers.js';

const db = newDb();
afterAll(() => db.$client.end());
type R = Record<string, unknown> & { id: string };

describe('комментарии: треды, назначение, завершение', () => {
  it('ответы любой вложенности; назначение и завершение — по правилам; корень уносит тред', async () => {
    const w = await world(db);
    const t = taskArgs(w);
    await w.member.ok('task.create', t);
    const root = uuidv7();
    await w.member.ok('comment.create', {
      id: root,
      taskId: t.id,
      body: doc('корень'),
      assigneeId: w.admin.userId,
    });
    const reply = uuidv7();
    await w.guest.ok('comment.create', {
      id: reply,
      taskId: t.id,
      body: doc('ответ'),
      parentId: root,
    });
    // a reply to a reply — any depth (PLANARAPP-45)
    const deep = uuidv7();
    await w.member.ok('comment.create', {
      id: deep,
      taskId: t.id,
      body: doc('ответ на ответ'),
      parentId: reply,
    });
    // assigning a guest — invalid_args; a reply of any depth is assigned (PLNRAPP-135)
    expect(
      await w.member.push('comment.create', {
        id: uuidv7(),
        taskId: t.id,
        body: doc('x'),
        assigneeId: w.guest.userId,
      }),
    ).toMatchObject({ code: 'invalid_args' });
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: t.id,
      body: doc('назначенный ответ'),
      parentId: reply,
      assigneeId: w.member.userId,
    });

    // assignee/author/admin can resolve, guest cannot; reassignment reopens it
    expect(await w.guest.push('comment.resolve', { id: root, resolved: true })).toMatchObject({
      code: 'forbidden',
    });
    await w.admin.ok('comment.resolve', { id: root, resolved: true });
    const get = async (id: string) =>
      ((await w.admin.bootstrap()).data.comments as R[]).find((c) => c.id === id);
    expect(await get(root)).toMatchObject({ resolvedBy: w.admin.userId });
    await w.member.ok('comment.assign', { id: root, assigneeId: w.member.userId });
    expect(await get(root)).toMatchObject({ assigneeId: w.member.userId, resolvedAt: null });
    await w.member.ok('comment.assign', { id: deep, assigneeId: w.admin.userId });
    await w.admin.ok('comment.resolve', { id: deep, resolved: true });
    expect(await get(deep)).toMatchObject({
      assigneeId: w.admin.userId,
      resolvedBy: w.admin.userId,
    });

    // assignee gets a comment_assigned notification
    const notes = (await w.member.bootstrap()).data.notifications as R[];
    expect(notes.some((n) => n.kind === 'comment_assigned' && n.commentId === root)).toBe(false); // not to oneself
    const adminNotes = (await w.admin.bootstrap()).data.notifications as R[];
    expect(adminNotes.some((n) => n.kind === 'comment_assigned' && n.commentId === root)).toBe(
      true,
    );

    await w.member.ok('comment.delete', { id: root });
    expect(await get(reply)).toBeUndefined();
    expect(await get(deep)).toBeUndefined();
  });
});
