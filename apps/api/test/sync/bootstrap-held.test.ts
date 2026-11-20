import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { SYNC_PROTOCOL, uuidv7 } from '@planar/shared';
import * as schema from '../../src/db/schema.js';
import { ServerTx } from '../../src/sync/server-tx.js';
import { NOW, doc, newDb, taskArgs, world, type World } from './helpers.js';

const db = newDb();
afterAll(() => db.$client.end());

type Row = Record<string, unknown>;

/** A task with a comment and a reaction to it (by admin); returns the ids. */
async function withDetails(w: World, over: Record<string, unknown> = {}) {
  const t = taskArgs(w, over);
  await w.admin.ok('task.create', t);
  const comment = uuidv7();
  const reaction = uuidv7();
  await w.admin.ok('comment.create', { id: comment, taskId: t.id, body: doc('c') });
  await w.admin.ok('reaction.toggle', { id: reaction, commentId: comment, emoji: '👍' });
  return { id: t.id, comment, reaction };
}

async function notify(w: World, userId: string, taskId: string) {
  await db.transaction(async (tx) => {
    const stx = ServerTx.asSystem(tx, { userId: w.admin.userId });
    await stx.put('notifications', {
      id: uuidv7(),
      userId,
      spaceId: w.spaceId,
      kind: 'commented',
      taskId,
      url: null,
      body: null,
      commentId: null,
      changes: null,
      actorId: w.admin.userId,
      readAt: null,
      createdAt: NOW,
    });
    await stx.finish();
  });
}

const ids = (rows: Row[] | undefined) => (rows ?? []).map((r) => r.id as string).sort();

describe('bootstrap v3: детали только «моих» задач', () => {
  it('held — неразрешённые назначенные мне и задачи моих уведомлений; детали — только их', async () => {
    const w = await world(db);
    const me = w.member.userId;
    const open = await withDetails(w); // todo, assigned to me → mine
    const inProgress = await withDetails(w, { statusId: w.statusIds[2] }); // in_progress → mine
    const done = await withDetails(w, { statusId: w.statusIds[3] }); // done → not mine
    const cancelled = await withDetails(w, { statusId: w.statusIds[4] }); // cancelled → not mine
    const notified = await withDetails(w); // not assigned, notification → mine
    const foreign = await withDetails(w); // neither → not mine
    for (const t of [open, inProgress, done, cancelled])
      await w.admin.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: me });
    // auto-notifications of the assignment are not under test: only the explicit ones below
    await db.delete(schema.notifications).where(eq(schema.notifications.userId, me));
    await notify(w, me, notified.id);
    await notify(w, me, uuidv7()); // a task that does not exist — not held
    await notify(w, w.guest.userId, foreign.id); // someone else's notification — not mine

    const mine = [open, inProgress, notified];
    const b = await w.member.bootstrap(SYNC_PROTOCOL);
    expect([...b.held!].sort()).toEqual(mine.map((t) => t.id).sort());
    const all = [open, inProgress, done, cancelled, notified, foreign];
    expect(ids(b.data.tasks)).toEqual(expect.arrayContaining(all.map((t) => t.id).sort()));
    expect(ids(b.data.comments)).toEqual(mine.map((t) => t.comment).sort());
    expect(ids(b.data.commentReactions)).toEqual(mine.map((t) => t.reaction).sort());

    // v2 (no protocol): details in full, no held
    const v2 = await w.member.bootstrap();
    expect(v2.held).toBeUndefined();
    expect(ids(v2.data.comments)).toEqual(all.map((t) => t.comment).sort());
    expect(ids(v2.data.commentReactions)).toEqual(all.map((t) => t.reaction).sort());
  });

  it('уведомление о задаче чужого пространства не делает её «моей»', async () => {
    const w = await world(db);
    const other = await world(db);
    const t = await withDetails(other);
    await notify(w, w.member.userId, t.id);
    const b = await w.member.bootstrap(SYNC_PROTOCOL);
    expect(b.held).not.toContain(t.id);
    expect(ids(b.data.comments)).not.toContain(t.comment);
  });
});
