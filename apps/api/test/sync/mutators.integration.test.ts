import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { PullService } from '../../src/sync/pull.service.js';
import { doc, key, mkUser, newDb, TestClient, services, taskArgs, world } from './helpers.js';

const db = newDb();
afterAll(() => db.$client.end());

const forbidden = { ok: false, code: 'forbidden' };

describe('мутаторы через push: права', () => {
  it('guest не создаёт задачу (forbidden), member создаёт', async () => {
    const w = await world(db);
    expect(await w.guest.push('task.create', taskArgs(w))).toMatchObject(forbidden);
    expect(await w.member.push('task.create', taskArgs(w))).toMatchObject({ ok: true });
  });

  it('посторонний (не участник) ничего не пишет в пространство', async () => {
    const w = await world(db);
    expect(await w.outsider.push('task.create', taskArgs(w))).toMatchObject(forbidden);
    expect(
      await w.outsider.push('project.create', {
        id: uuidv7(),
        spaceId: w.spaceId,
        name: 'x',
        key: key(),
        rank: 'a0',
      }),
    ).toMatchObject(forbidden);
  });

  it('статусы — только admin пространства', async () => {
    const w = await world(db);
    const args = () => ({
      id: uuidv7(),
      spaceId: w.spaceId,
      name: 'Review',
      category: 'todo',
      color: '#fff',
      rank: 'a5',
    });
    expect(await w.member.push('status.create', args())).toMatchObject(forbidden);
    expect(await w.admin.push('status.create', args())).toMatchObject({ ok: true });
  });

  it('guest может комментировать и наблюдать, но не назначать', async () => {
    const w = await world(db);
    const t = taskArgs(w);
    await w.member.ok('task.create', t);
    await w.guest.ok('comment.create', { id: uuidv7(), taskId: t.id, body: doc('привет') });
    await w.guest.ok('task.watch', { id: uuidv7(), taskId: t.id });
    expect(
      await w.guest.push('task.assign', { id: uuidv7(), taskId: t.id, userId: w.guest.userId }),
    ).toMatchObject(forbidden);
  });

  it('guest инстанса не создаёт пространство, member — создаёт', async () => {
    const guest = new TestClient(services(db), await mkUser(db, 'guest'));
    const member = new TestClient(services(db), await mkUser(db, 'member'));
    const mk = () => ({
      id: uuidv7(),
      name: 'N',
      rank: 'a0',
      memberId: uuidv7(),
      statusIds: Array.from({ length: 5 }, () => uuidv7()),
    });
    expect(await guest.push('space.create', mk())).toMatchObject(forbidden);
    await member.ok('space.create', mk());
  });

  it('settings.set — только admin/owner инстанса', async () => {
    const m = new TestClient(services(db), await mkUser(db, 'member'));
    const a = new TestClient(services(db), await mkUser(db, 'admin'));
    const id = `k${uuidv7()}`;
    expect(await m.push('settings.set', { id, value: 1 })).toMatchObject(forbidden);
    await a.ok('settings.set', { id, value: 1 });
  });

  it('чужие уведомления: notification.read → forbidden', async () => {
    const w = await world(db);
    const nid = uuidv7();
    await db.$client.query(
      `insert into notifications (id, user_id, space_id, kind, task_id, actor_id) values ($1,$2,$3,'assigned',$4,$5)`,
      [nid, w.member.userId, w.spaceId, uuidv7(), w.admin.userId],
    );
    expect(await w.admin.push('notification.read', { ids: [nid] })).toMatchObject(forbidden);
    await w.member.ok('notification.read', { ids: [nid] });
    const n = (await w.member.bootstrap()).data.notifications!.find((x) => x.id === nid)!;
    expect(n.readAt).not.toBeNull();
  });
});

describe('мутаторы через push: данные', () => {
  it('number задач растёт по проекту', async () => {
    const w = await world(db);
    const p2 = uuidv7();
    await w.admin.ok('project.create', {
      id: p2,
      spaceId: w.spaceId,
      name: 'P2',
      key: key(),
      rank: 'a1',
    });
    const a = taskArgs(w);
    const b = taskArgs(w);
    const c = taskArgs(w, { projectId: p2 });
    for (const t of [a, b, c]) await w.member.ok('task.create', t);
    const rows = (await w.member.bootstrap()).data.tasks!;
    const n = (id: string) => rows.find((r) => r.id === id)!.number;
    expect([n(a.id), n(b.id), n(c.id)]).toEqual([1, 2, 1]);
  });

  it('дубль ключа проекта → conflict', async () => {
    const w = await world(db);
    const k = key();
    await w.admin.ok('project.create', {
      id: uuidv7(),
      spaceId: w.spaceId,
      name: 'A',
      key: k,
      rank: 'a1',
    });
    expect(
      await w.admin.push('project.create', {
        id: uuidv7(),
        spaceId: w.spaceId,
        name: 'B',
        key: k,
        rank: 'a2',
      }),
    ).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('space.create: пространство, участник-admin и 5 статусов', async () => {
    const w = await world(db);
    const b = await w.admin.bootstrap();
    expect(
      b.data
        .statuses!.filter((s) => s.spaceId === w.spaceId)
        .map((s) => s.category)
        .sort(),
    ).toEqual(['backlog', 'cancelled', 'done', 'in_progress', 'todo']);
    expect(
      b.data.spaceMembers!.find((m) => m.spaceId === w.spaceId && m.userId === w.admin.userId),
    ).toMatchObject({ role: 'admin' });
  });

  it('space.delete целиком (создатель теряет членство до пространства, но права сохраняются)', async () => {
    const w = await world(db);
    await w.admin.ok('project.delete', { id: w.projectId });
    // участники member/guest удаляются тем же мутатором
    await w.admin.ok('space.delete', { id: w.spaceId });
    const b = await w.admin.bootstrap();
    expect(b.data.spaces!.some((s) => s.id === w.spaceId)).toBe(false);
    for (const e of ['statuses', 'spaceMembers', 'projects'])
      expect(
        b.data[e]!.some((r) => r.spaceId === w.spaceId),
        e,
      ).toBe(false);
  });

  it('space.delete с проектами → conflict', async () => {
    const w = await world(db);
    expect(await w.admin.push('space.delete', { id: w.spaceId })).toMatchObject({
      code: 'conflict',
    });
    expect((await w.admin.bootstrap()).data.spaces!.some((s) => s.id === w.spaceId)).toBe(true);
  });

  it('space.delete не-admin → forbidden', async () => {
    const w = await world(db);
    await w.admin.ok('project.delete', { id: w.projectId });
    expect(await w.member.push('space.delete', { id: w.spaceId })).toMatchObject(forbidden);
  });

  it('удаление родителя рекурсивно: подзадачи, метки, исполнители, комментарии', async () => {
    const w = await world(db);
    const parent = taskArgs(w);
    const child = taskArgs(w, { parentId: parent.id });
    const labelId = uuidv7();
    await w.member.ok('label.create', {
      id: labelId,
      spaceId: w.spaceId,
      name: 'bug',
      color: '#f00',
    });
    await w.member.ok('task.create', parent);
    await w.member.ok('task.create', {
      ...child,
      labels: [{ id: uuidv7(), labelId }],
      assignees: [{ id: uuidv7(), userId: w.member.userId }],
    });
    await w.guest.ok('comment.create', { id: uuidv7(), taskId: child.id, body: doc('x') });
    const { cursor } = await w.admin.bootstrap();
    await w.member.ok('task.delete', { id: parent.id });
    const b = await w.admin.bootstrap();
    for (const e of ['tasks', 'taskLabels', 'taskAssignees', 'comments'])
      expect(
        b.data[e]!.filter((r) => r.id === parent.id || r.id === child.id || r.taskId === child.id),
        e,
      ).toEqual([]);
    const dels = (await w.admin.pull(cursor)).changes
      .filter((c) => c.op === 'del')
      .map((c) => c.entity);
    expect(dels).toEqual(
      expect.arrayContaining(['tasks', 'taskLabels', 'taskAssignees', 'comments']),
    );
  });

  it('member.update / remove последнего admin → conflict', async () => {
    const w = await world(db);
    const mem = (await w.admin.bootstrap()).data.spaceMembers!.find(
      (m) => m.spaceId === w.spaceId && m.userId === w.admin.userId,
    )!;
    expect(await w.admin.push('member.remove', { id: mem.id })).toMatchObject({ code: 'conflict' });
    expect(await w.admin.push('member.update', { id: mem.id, role: 'member' })).toMatchObject({
      code: 'conflict',
    });
  });
});

describe('activity', () => {
  it('created / updated / assignee / label / commented пишутся и читаются через taskActivity', async () => {
    const w = await world(db);
    const pull = new PullService(db);
    const t = taskArgs(w, { title: 'Старый' });
    const labelId = uuidv7();
    await w.member.ok('label.create', {
      id: labelId,
      spaceId: w.spaceId,
      name: 'bug',
      color: '#f00',
    });
    await w.member.ok('task.create', t);
    await w.member.ok('task.update', { id: t.id, title: 'Новый' });
    await w.member.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: w.member.userId });
    await w.member.ok('task.addLabel', { id: uuidv7(), taskId: t.id, labelId });
    await w.guest.ok('comment.create', { id: uuidv7(), taskId: t.id, body: doc('привет') });
    const { rows } = await pull.taskActivity(w.guest.userId, t.id);
    expect(rows.map((r) => r.kind)).toEqual([
      'created',
      'updated',
      'assignee_added',
      'label_added',
      'commented',
    ]);
    expect(rows[1].changes).toEqual({ title: ['Старый', 'Новый'] });
    expect(rows[2].changes).toEqual({ userId: w.member.userId });
    expect(rows[3].changes).toEqual({ labelId });
    expect(rows.every((r) => r.spaceId === w.spaceId)).toBe(true);
  });

  it('task.update без изменений полей не пишет activity', async () => {
    const w = await world(db);
    const t = taskArgs(w, { title: 'Тот же' });
    await w.member.ok('task.create', t);
    await w.member.ok('task.update', { id: t.id, title: 'Тот же' });
    const { rows } = await new PullService(db).taskActivity(w.member.userId, t.id);
    expect(rows.map((r) => r.kind)).toEqual(['created']);
  });

  it('activity задачи чужого пространства → 404; история переживает удаление задачи', async () => {
    const w = await world(db);
    const pull = new PullService(db);
    const t = taskArgs(w);
    await w.member.ok('task.create', t);
    await expect(pull.taskActivity(w.outsider.userId, t.id)).rejects.toMatchObject({ status: 404 });
    await expect(pull.taskActivity(w.member.userId, uuidv7())).rejects.toMatchObject({
      status: 404,
    });
    await w.member.ok('task.delete', { id: t.id });
    const { rows } = await pull.taskActivity(w.member.userId, t.id);
    expect(rows.map((r) => r.kind)).toEqual(['created', 'deleted']);
  });
});
