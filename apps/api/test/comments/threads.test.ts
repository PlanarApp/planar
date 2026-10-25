import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { doc, newDb, taskArgs, world } from '../sync/helpers.js';

const db = newDb();
afterAll(() => db.$client.end());
type R = Record<string, unknown> & { id: string };

describe('комментарии: треды, назначение, завершение', () => {
  it('ответ — только на корень; назначение и завершение — по правилам; корень уносит тред', async () => {
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
    // ответ на ответ, назначение ответа и гостя — invalid_args
    for (const a of [
      { parentId: reply },
      { parentId: root, assigneeId: w.member.userId },
      { assigneeId: w.guest.userId },
    ])
      expect(
        await w.member.push('comment.create', { id: uuidv7(), taskId: t.id, body: doc('x'), ...a }),
      ).toMatchObject({ code: 'invalid_args' });

    // завершить может исполнитель/автор/admin, гость — нет; переназначение снова открывает
    expect(await w.guest.push('comment.resolve', { id: root, resolved: true })).toMatchObject({
      code: 'forbidden',
    });
    await w.admin.ok('comment.resolve', { id: root, resolved: true });
    const get = async (id: string) =>
      ((await w.admin.bootstrap()).data.comments as R[]).find((c) => c.id === id);
    expect(await get(root)).toMatchObject({ resolvedBy: w.admin.userId });
    await w.member.ok('comment.assign', { id: root, assigneeId: w.member.userId });
    expect(await get(root)).toMatchObject({ assigneeId: w.member.userId, resolvedAt: null });
    expect(await w.member.push('comment.assign', { id: reply, assigneeId: null })).toMatchObject({
      code: 'invalid_args',
    });

    // исполнителю — уведомление comment_assigned
    const notes = (await w.member.bootstrap()).data.notifications as R[];
    expect(notes.some((n) => n.kind === 'comment_assigned' && n.commentId === root)).toBe(false); // сам себе — нет
    const adminNotes = (await w.admin.bootstrap()).data.notifications as R[];
    expect(adminNotes.some((n) => n.kind === 'comment_assigned' && n.commentId === root)).toBe(
      true,
    );

    await w.member.ok('comment.delete', { id: root });
    expect(await get(reply)).toBeUndefined();
  });
});
