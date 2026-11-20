// PLNRAPP-576: counters of assigned comments on the tasks row (list and board) and in REST v1 tasks
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { assignedCommentsOf, uuidv7 } from '@planar/shared';
import * as s from '../../src/db/schema.js';
import { toV1Tasks } from '../../src/rest/v1-tasks.js';
import { doc, newDb, taskArgs, world } from '../sync/helpers.js';

const db = newDb();
afterAll(() => db.$client.end());
type R = Record<string, unknown> & { id: string };

const row = async (id: string) => (await db.select().from(s.tasks).where(eq(s.tasks.id, id)))[0]!;
const counters = async (id: string) => {
  const t = await row(id);
  return {
    commentsAssigned: t.commentsAssigned,
    commentsResolved: t.commentsResolved,
    commentsOpenAssignees: [...t.commentsOpenAssignees].sort(),
  };
};

describe('счётчики назначенных комментариев задачи', () => {
  it('назначение, решение, переназначение и удаление меняют счётчики; подзадачи не суммируются', async () => {
    const w = await world(db);
    const t = taskArgs(w);
    await w.member.ok('task.create', t);
    const sub = taskArgs(w, { parentId: t.id });
    await w.member.ok('task.create', sub);
    const zero = { commentsAssigned: 0, commentsResolved: 0, commentsOpenAssignees: [] };
    expect(await counters(t.id)).toEqual(zero);
    const before = await row(t.id);

    // a plain comment is not counted
    await w.member.ok('comment.create', { id: uuidv7(), taskId: t.id, body: doc('просто') });
    expect(await counters(t.id)).toEqual(zero);

    const c1 = uuidv7();
    await w.member.ok('comment.create', {
      id: c1,
      taskId: t.id,
      body: doc('сделай'),
      assigneeId: w.admin.userId,
    });
    const c2 = uuidv7();
    await w.member.ok('comment.create', { id: c2, taskId: t.id, body: doc('и это') });
    await w.member.ok('comment.assign', { id: c2, assigneeId: w.member.userId });
    expect(await counters(t.id)).toEqual({
      commentsAssigned: 2,
      commentsResolved: 0,
      commentsOpenAssignees: [w.admin.userId, w.member.userId].sort(),
    });

    // a comment of the subtask stays with the subtask
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: sub.id,
      body: doc('подзадача'),
      assigneeId: w.admin.userId,
    });
    expect(await counters(sub.id)).toEqual({
      commentsAssigned: 1,
      commentsResolved: 0,
      commentsOpenAssignees: [w.admin.userId],
    });
    expect((await counters(t.id)).commentsAssigned).toBe(2);

    await w.admin.ok('comment.resolve', { id: c1, resolved: true });
    expect(await counters(t.id)).toEqual({
      commentsAssigned: 2,
      commentsResolved: 1,
      commentsOpenAssignees: [w.member.userId],
    });
    // reassignment reopens; unassigning drops it from the total
    await w.member.ok('comment.assign', { id: c1, assigneeId: w.member.userId });
    expect(await counters(t.id)).toEqual({
      commentsAssigned: 2,
      commentsResolved: 0,
      commentsOpenAssignees: [w.member.userId],
    });
    await w.member.ok('comment.assign', { id: c2, assigneeId: null });
    expect(await counters(t.id)).toEqual({
      commentsAssigned: 1,
      commentsResolved: 0,
      commentsOpenAssignees: [w.member.userId],
    });
    await w.member.ok('comment.resolve', { id: c1, resolved: true });
    expect(await counters(t.id)).toEqual({
      commentsAssigned: 1,
      commentsResolved: 1,
      commentsOpenAssignees: [],
    });
    await w.member.ok('comment.delete', { id: c1 });
    expect(await counters(t.id)).toEqual(zero);

    // a counters write is not a task edit: updatedAt is the same, no «updated» activity
    expect((await row(t.id)).updatedAt).toEqual(before.updatedAt);
    const acts = (await db.select().from(s.activity).where(eq(s.activity.taskId, t.id))).filter(
      (a) => a.kind === 'updated',
    );
    expect(acts).toEqual([]);
  });

  it('счётчики приходят в pull строкой задачи; мутатор не может их переписать', async () => {
    const w = await world(db);
    const t = taskArgs(w);
    await w.member.ok('task.create', t);
    const { cursor } = await w.admin.bootstrap();
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: t.id,
      body: doc('сделай'),
      assigneeId: w.admin.userId,
    });
    const p = await w.admin.pull(cursor);
    const puts = p.changes.filter((c) => c.entity === 'tasks' && c.id === t.id && c.op === 'put');
    expect(puts.at(-1)?.data).toMatchObject({
      commentsAssigned: 1,
      commentsResolved: 0,
      commentsOpenAssignees: [w.admin.userId],
    });

    // task.update keeps the counters (the server takes them from the row, not from the mutator)
    await w.member.ok('task.update', { id: t.id, title: 'новое' });
    expect(await counters(t.id)).toMatchObject({ commentsAssigned: 1 });
  });

  it('слияние задач переносит счётчики вместе с комментариями', async () => {
    const w = await world(db);
    const a = taskArgs(w);
    const b = taskArgs(w);
    await w.member.ok('task.create', a);
    await w.member.ok('task.create', b);
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: b.id,
      body: doc('сделай'),
      assigneeId: w.member.userId,
    });
    await w.member.ok('task.merge', { ids: [b.id], targetId: a.id, linkIds: [uuidv7()] });
    expect(await counters(a.id)).toMatchObject({ commentsAssigned: 1 });
    expect(await counters(b.id)).toMatchObject({ commentsAssigned: 0 });
  });

  it('REST v1: assignedComments — total, resolved и assignedToMe для запросившего', async () => {
    const w = await world(db);
    const t = taskArgs(w);
    await w.member.ok('task.create', t);
    for (const assigneeId of [w.admin.userId, w.member.userId])
      await w.member.ok('comment.create', {
        id: uuidv7(),
        taskId: t.id,
        body: doc('сделай'),
        assigneeId,
      });
    const c = ((await w.member.bootstrap()).data.comments as R[]).find(
      (x) => x.taskId === t.id && x.assigneeId === w.admin.userId,
    )!;
    await w.admin.ok('comment.resolve', { id: c.id, resolved: true });
    const r = await row(t.id);
    const [forMember] = await toV1Tasks(db, [r], w.member.userId);
    expect(forMember!.assignedComments).toEqual({ total: 2, resolved: 1, assignedToMe: true });
    const [forAdmin] = await toV1Tasks(db, [r], w.admin.userId);
    expect(forAdmin!.assignedComments).toEqual({ total: 2, resolved: 1, assignedToMe: false });
    const [noUser] = await toV1Tasks(db, [r]);
    expect(noUser!.assignedComments.assignedToMe).toBe(false);
    // replica rows before C-schema v30 have no counters — zeros
    expect(assignedCommentsOf({}, w.member.userId)).toEqual({
      total: 0,
      resolved: 0,
      assignedToMe: false,
    });
  });
});
