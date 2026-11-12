// PLNRAPP-152: a task moved to another space takes along its subtasks and tied rows; replicas follow
import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { doc, key, newDb, NOW, world } from './helpers.js';

const db = newDb();
afterAll(() => db.$client.end());

describe('PLNRAPP-152 перенос задачи в другое пространство', () => {
  it('подзадачи, комментарии, реакции, время, связи — в новом пространстве; реплики: del старому, put новому', async () => {
    const w = await world(db);
    // space B: admin and outsider; the guest stays in A only
    const b = uuidv7();
    const pb = uuidv7();
    await w.admin.ok('space.create', { id: b, name: 'B', rank: 'a1', memberId: uuidv7() });
    await w.admin.ok('member.add', {
      id: uuidv7(),
      spaceId: b,
      userId: w.outsider.userId,
      role: 'member',
    });
    await w.admin.ok('project.create', { id: pb, spaceId: b, name: 'PB', key: key(), rank: 'a0' });

    const task = (over: object = {}) => ({
      id: uuidv7(),
      projectId: w.projectId,
      statusId: w.statusIds[1],
      title: 'T',
      rank: 'a0',
      ...over,
    });
    const t = task();
    const kid = task({ parentId: t.id });
    const other = task();
    const third = task();
    for (const x of [t, kid, other, third]) await w.admin.ok('task.create', x);
    const comment = uuidv7();
    const reaction = uuidv7();
    const entry = uuidv7();
    const [out, into] = [uuidv7(), uuidv7()];
    await w.admin.ok('comment.create', { id: comment, taskId: t.id, body: doc('c') });
    await w.admin.ok('reaction.toggle', { id: reaction, commentId: comment, emoji: '👍' });
    await w.admin.ok('time.log', { id: entry, taskId: kid.id, startedAt: NOW, durationSec: 60 });
    await w.admin.ok('link.create', { id: out, taskId: t.id, targetId: other.id, kind: 'blocks' });
    await w.admin.ok('link.create', {
      id: into,
      taskId: third.id,
      targetId: t.id,
      kind: 'relates',
    });

    const [ga, oa, aa] = await Promise.all(
      [w.guest, w.outsider, w.admin].map((c) => c.bootstrap()),
    );
    // the move needs write access to both spaces
    expect(await w.member.push('task.update', { id: t.id, projectId: pb })).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    await w.admin.ok('task.update', { id: t.id, projectId: pb });

    const ops = async (c: typeof w.guest, cursor: number) => {
      const last = new Map<string, string>();
      for (const ch of (await c.pull(cursor)).changes) last.set(`${ch.entity}:${ch.id}`, ch.op);
      return last;
    };
    const moved = [
      `tasks:${t.id}`,
      `tasks:${kid.id}`,
      `comments:${comment}`,
      `commentReactions:${reaction}`,
      `timeEntries:${entry}`,
      `taskLinks:${out}`,
    ];
    const guest = await ops(w.guest, ga.cursor);
    const outsider = await ops(w.outsider, oa.cursor);
    const admin = await ops(w.admin, aa.cursor);
    for (const k of moved) {
      expect(guest.get(k), k).toBe('del');
      expect(outsider.get(k), k).toBe('put');
      expect(admin.get(k), k).toBe('put'); // both spaces: del, then put
    }
    // the link into the moved task belongs to the task left in A
    expect(guest.has(`taskLinks:${into}`)).toBe(false);

    const ob = await w.outsider.bootstrap();
    const mine = ob.data.tasks!.filter((x) => x.projectId === pb);
    expect(mine.map((x) => x.id).sort()).toEqual([t.id, kid.id].sort());
    expect(mine.every((x) => x.spaceId === b && typeof x.number === 'number')).toBe(true);
    expect(mine.find((x) => x.id === kid.id)!.parentId).toBe(t.id);
    expect(ob.data.taskLinks!.map((x) => x.id)).toEqual([out]);
    const gb = await w.guest.bootstrap();
    expect(gb.data.tasks!.map((x) => x.id).sort()).toEqual([other.id, third.id].sort());
    expect(gb.data.taskLinks!.map((x) => x.id)).toEqual([into]);
  });

  it('PLNRAPP-5 перенос документа в другое пространство: подстраницы, ссылки на задачи, реплики', async () => {
    const w = await world(db);
    const b = uuidv7();
    const pb = uuidv7();
    await w.admin.ok('space.create', { id: b, name: 'B', rank: 'a1', memberId: uuidv7() });
    await w.admin.ok('member.add', {
      id: uuidv7(),
      spaceId: b,
      userId: w.outsider.userId,
      role: 'member',
    });
    await w.admin.ok('project.create', { id: pb, spaceId: b, name: 'PB', key: key(), rank: 'a0' });

    const rootId = uuidv7();
    const kidId = uuidv7();
    const taskId = uuidv7();
    const linkId = uuidv7();
    await w.admin.ok('task.create', {
      id: taskId,
      projectId: w.projectId,
      statusId: w.statusIds[1],
      title: 'T',
      rank: 'a0',
    });
    await w.admin.ok('docs.page.create', {
      id: rootId,
      spaceId: w.spaceId,
      title: 'Root Doc',
      rank: 'a0',
    });
    await w.admin.ok('docs.page.create', {
      id: kidId,
      spaceId: w.spaceId,
      parentId: rootId,
      title: 'Kid Doc',
      rank: 'a0',
    });
    await w.admin.ok('docs.link.add', {
      id: linkId,
      pageId: rootId,
      taskId,
    });

    const [ga, oa, aa] = await Promise.all(
      [w.guest, w.outsider, w.admin].map((c) => c.bootstrap()),
    );

    // outsider cannot move docs from space A (not a member of A)
    expect(
      await w.outsider.push('docs.page.move', {
        id: rootId,
        parentId: null,
        rank: 'b0',
        projectId: pb,
      }),
    ).toMatchObject({ ok: false, code: 'forbidden' });

    // member of A who is not in B cannot move to B
    expect(
      await w.member.push('docs.page.move', {
        id: rootId,
        parentId: null,
        rank: 'b0',
        projectId: pb,
      }),
    ).toMatchObject({ ok: false, code: 'forbidden' });

    // admin (member of both) moves to project pb in space B
    await w.admin.ok('docs.page.move', {
      id: rootId,
      parentId: null,
      rank: 'b0',
      projectId: pb,
    });

    const ops = async (c: typeof w.guest, cursor: number) => {
      const last = new Map<string, string>();
      for (const ch of (await c.pull(cursor)).changes) last.set(`${ch.entity}:${ch.id}`, ch.op);
      return last;
    };
    const moved = [`docsPages:${rootId}`, `docsPages:${kidId}`, `docsTaskLinks:${linkId}`];
    const guest = await ops(w.guest, ga.cursor);
    const outsider = await ops(w.outsider, oa.cursor);
    const admin = await ops(w.admin, aa.cursor);
    for (const k of moved) {
      expect(guest.get(k), k).toBe('del');
      expect(outsider.get(k), k).toBe('put');
      expect(admin.get(k), k).toBe('put');
    }

    const ob = await w.outsider.bootstrap();
    const mine = ob.data.docsPages!.filter((x) => x.spaceId === b);
    expect(mine.map((x) => x.id).sort()).toEqual([rootId, kidId].sort());
    expect(mine.every((x) => x.projectId === pb)).toBe(true);
    expect(mine.find((x) => x.id === kidId)!.parentId).toBe(rootId);
    expect(ob.data.docsTaskLinks!.map((x) => x.id)).toEqual([linkId]);

    // move to space B without a project (space level)
    await w.admin.ok('docs.page.move', {
      id: rootId,
      parentId: null,
      rank: 'c0',
      spaceId: b,
      projectId: null,
    });
    const ob2 = await w.outsider.bootstrap();
    const mine2 = ob2.data.docsPages!.filter((x) => x.spaceId === b);
    expect(mine2.every((x) => x.projectId === null)).toBe(true);
  });
});
