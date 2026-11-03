import { describe, expect, it } from 'vitest';
import {
  addProject,
  code,
  ctx,
  id,
  mem,
  run,
  seedSpace,
  seedTask,
  T0,
  T1,
  U1,
  U2,
} from './helpers';

describe('space/member', () => {
  it('space.create: пространство и admin, без статусов; project.create — 5 статусов проекта', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const sp = (await tx.get('spaces', s.spaceId))!;
    expect(sp).toMatchObject({ name: 'S', createdBy: U1, createdAt: ctx().now });
    const ms = await tx.scan('spaceMembers', { index: 'spaceId', eq: s.spaceId });
    expect(ms).toMatchObject([{ userId: U1, role: 'admin' }]);
    const empty = id();
    await run(tx, 'space.create', { id: empty, name: 'E', rank: 'a1', memberId: id() });
    expect(await tx.scan('statuses', { index: 'spaceId', eq: empty })).toEqual([]);
    const sts = (await tx.scan('statuses', { index: 'projectId', eq: s.projectId })).sort((a, b) =>
      a.rank.localeCompare(b.rank),
    );
    expect(sts.map((x) => [x.name, x.category, x.rank])).toEqual([
      ['Backlog', 'backlog', 'a0'],
      ['Todo', 'todo', 'a1'],
      ['In Progress', 'in_progress', 'a2'],
      ['Done', 'done', 'a3'],
      ['Cancelled', 'cancelled', 'a4'],
    ]);
    expect(sts.map((x) => x.id)).toEqual(s.statusIds);
  });

  it('project.create: statusNames переименовывает, пустое/длинное — по умолчанию', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const p = id();
    await run(tx, 'project.create', {
      id: p,
      spaceId: s.spaceId,
      name: 'N',
      key: 'NN',
      rank: 'a2',
      statusIds: [id(), id(), id(), id(), id()],
      statusNames: { todo: ' К работе ', done: '  ', cancelled: 'x'.repeat(65) },
    });
    const sts = await tx.scan('statuses', { index: 'projectId', eq: p });
    const n = (c: string) => sts.find((x) => x.category === c)!.name;
    expect([n('todo'), n('done'), n('cancelled'), n('backlog')]).toEqual([
      'К работе',
      'Done',
      'Cancelled',
      'Backlog',
    ]);
  });

  it('project.create: statusIds не 5 → ошибка; ни statusIds, ни copyFrom → invalid_args', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const a = { id: id(), spaceId: s.spaceId, name: 'S', key: 'SS', rank: 'a3' };
    await expect(run(tx, 'project.create', { ...a, statusIds: [id()] })).rejects.toThrow();
    expect(await code(run(tx, 'project.create', a))).toBe('invalid_args');
  });

  it('space.update: только переданные поля, null обнуляет, not_found', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    await run(tx, 'space.update', { id: s.spaceId, description: 'd', color: '#fff' });
    await run(tx, 'space.update', { id: s.spaceId, name: 'N', color: null }, ctx(U1, T1));
    expect(await tx.get('spaces', s.spaceId)).toMatchObject({
      name: 'N',
      description: 'd',
      color: null,
      updatedAt: T1,
    });
    expect(await code(run(tx, 'space.update', { id: id(), name: 'x' }))).toBe('not_found');
  });

  it('space.delete: есть проекты → conflict', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    expect(await code(run(tx, 'space.delete', { id: s.spaceId }))).toBe('conflict');
  });

  it('space.delete: удаляет статусы, метки, виды, участников; not_found', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    await run(tx, 'project.delete', { id: s.projectId });
    await run(tx, 'project.create', {
      id: id(),
      spaceId: s.spaceId,
      name: 'Q',
      key: 'QQ',
      rank: 'a1',
      statusIds: [id(), id(), id(), id(), id()],
    });
    await run(tx, 'view.create', {
      id: id(),
      spaceId: s.spaceId,
      personal: false,
      name: 'v',
      layout: 'list',
      filter: {},
      config: {},
      rank: 'a0',
    });
    await run(tx, 'label.create', {
      id: id(),
      projectId: (await tx.scan('projects', { index: 'spaceId', eq: s.spaceId }))[0]!.id,
      name: 'l',
      color: '#000',
    });
    await run(tx, 'space.delete', { id: s.spaceId, withContent: true });
    for (const e of ['spaces', 'statuses', 'labels', 'savedViews', 'spaceMembers'] as const)
      expect(await tx.scan(e)).toEqual([]);
    expect(await code(run(tx, 'space.delete', { id: s.spaceId }))).toBe('not_found');
  });

  it('member.add: добавляет; повтор → conflict; нет пространства → not_found', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const m = { id: id(), spaceId: s.spaceId, userId: U2, role: 'member' };
    await run(tx, 'member.add', m);
    expect(await tx.get('spaceMembers', m.id)).toMatchObject(m);
    expect(await code(run(tx, 'member.add', { ...m, id: id() }))).toBe('conflict');
    expect(await code(run(tx, 'member.add', { ...m, id: id(), spaceId: id() }))).toBe('not_found');
  });

  it('member.update/remove: последний admin → conflict, не последний — можно', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const [adm] = await tx.scan('spaceMembers', { index: 'spaceId', eq: s.spaceId });
    expect(await code(run(tx, 'member.update', { id: adm.id, role: 'member' }))).toBe('conflict');
    expect(await code(run(tx, 'member.remove', { id: adm.id }))).toBe('conflict');
    const m2 = id();
    await run(tx, 'member.add', { id: m2, spaceId: s.spaceId, userId: U2, role: 'admin' });
    await run(tx, 'member.update', { id: adm.id, role: 'guest' });
    expect((await tx.get('spaceMembers', adm.id))!.role).toBe('guest');
    expect(await code(run(tx, 'member.remove', { id: m2 }))).toBe('conflict');
    await run(tx, 'member.update', { id: adm.id, role: 'admin' });
    await run(tx, 'member.remove', { id: m2 });
    expect(await tx.get('spaceMembers', m2)).toBeUndefined();
    expect(await code(run(tx, 'member.update', { id: id(), role: 'admin' }))).toBe('not_found');
    expect(await code(run(tx, 'member.remove', { id: id() }))).toBe('not_found');
  });
});

describe('project/status/label', () => {
  it('project.create: значения по умолчанию; key неверный и пространство отсутствует', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    expect(await tx.get('projects', s.projectId)).toMatchObject({
      key: 'PRJ',
      description: null,
      leadId: null,
      archivedAt: null,
      spaceId: s.spaceId,
    });
    const a = {
      id: id(),
      spaceId: s.spaceId,
      name: 'P',
      key: 'AB',
      rank: 'a1',
      statusIds: [id(), id(), id(), id(), id()],
    };
    await expect(run(tx, 'project.create', { ...a, key: 'a' })).rejects.toThrow();
    await expect(run(tx, 'project.create', { ...a, key: 'ABCDEFGHIJK' })).rejects.toThrow();
    expect(await code(run(tx, 'project.create', { ...a, spaceId: id() }))).toBe('not_found');
  });

  it('project.update: частичное, archivedAt, not_found', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    await run(
      tx,
      'project.update',
      { id: s.projectId, name: 'N', archivedAt: T1, leadId: U1 },
      ctx(U1, T1),
    );
    expect(await tx.get('projects', s.projectId)).toMatchObject({
      name: 'N',
      key: 'PRJ',
      archivedAt: T1,
      leadId: U1,
    });
    await run(tx, 'project.update', { id: s.projectId, archivedAt: null });
    expect((await tx.get('projects', s.projectId))!.archivedAt).toBeNull();
    expect(await code(run(tx, 'project.update', { id: id(), name: 'x' }))).toBe('not_found');
  });

  it('project.delete: есть задачи → conflict; пустой удаляется; not_found', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const t = await seedTask(tx, s);
    expect(await code(run(tx, 'project.delete', { id: s.projectId }))).toBe('conflict');
    await run(tx, 'task.delete', { id: t });
    await run(tx, 'project.delete', { id: s.projectId });
    expect(await tx.get('projects', s.projectId)).toBeUndefined();
    expect(await code(run(tx, 'project.delete', { id: s.projectId }))).toBe('not_found');
  });

  it('status.create/update', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const sid = id();
    const a = {
      id: sid,
      projectId: s.projectId,
      name: 'Review',
      category: 'in_progress',
      color: '#0ff',
      rank: 'a5',
    };
    await run(tx, 'status.create', a);
    expect(await tx.get('statuses', sid)).toMatchObject({ ...a, spaceId: s.spaceId });
    expect(await code(run(tx, 'status.create', { ...a, id: id(), projectId: id() }))).toBe(
      'not_found',
    );
    await run(tx, 'status.update', { id: sid, name: 'R2', category: 'done' });
    expect(await tx.get('statuses', sid)).toMatchObject({
      name: 'R2',
      category: 'done',
      color: '#0ff',
    });
    expect(await code(run(tx, 'status.update', { id: id(), name: 'x' }))).toBe('not_found');
  });

  it('status.update: смена category пересчитывает completedAt задач', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const t = await seedTask(tx, s);
    const st = s.statusIds[1];
    await run(tx, 'status.update', { id: st, category: 'done' });
    expect(await tx.get('tasks', t)).toMatchObject({ completedAt: T0 });
    await run(tx, 'status.update', { id: st, category: 'todo' });
    expect(await tx.get('tasks', t)).toMatchObject({ completedAt: null });
  });

  it('status.delete: задачи уходят в replaceWith, completedAt по категории', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const t = await seedTask(tx, s, { statusId: s.statusIds[3] });
    expect((await tx.get('tasks', t))!.completedAt).toBe(ctx().now);
    await run(tx, 'status.delete', { id: s.statusIds[3], replaceWith: s.statusIds[1] });
    expect(await tx.get('statuses', s.statusIds[3])).toBeUndefined();
    expect(await tx.get('tasks', t)).toMatchObject({ statusId: s.statusIds[1], completedAt: null });
  });

  it('status.delete: другой проект → invalid_args, не найден → not_found, последний → conflict', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const s2 = await addProject(tx, s.spaceId, id(), 'OTH', 'a1'); // same space, another project
    expect(
      await code(run(tx, 'status.delete', { id: s.statusIds[0], replaceWith: s2.statusIds[0] })),
    ).toBe('invalid_args');
    expect(
      await code(run(tx, 'status.delete', { id: s.statusIds[0], replaceWith: s.statusIds[0] })),
    ).toBe('invalid_args');
    expect(await code(run(tx, 'status.delete', { id: s.statusIds[0], replaceWith: id() }))).toBe(
      'not_found',
    );
    expect(await code(run(tx, 'status.delete', { id: id(), replaceWith: s.statusIds[1] }))).toBe(
      'not_found',
    );
    for (const sid of s.statusIds.slice(1))
      await run(tx, 'status.delete', { id: sid, replaceWith: s.statusIds[0] });
    expect(
      await code(run(tx, 'status.delete', { id: s.statusIds[0], replaceWith: s.statusIds[0] })),
    ).toBe('conflict');
  });

  it('label.create/update/delete', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const t = await seedTask(tx, s);
    const l = id();
    await run(tx, 'label.create', { id: l, projectId: s.projectId, name: 'bug', color: '#f00' });
    expect(
      await code(run(tx, 'label.create', { id: id(), projectId: id(), name: 'x', color: '#f00' })),
    ).toBe('not_found');
    await run(tx, 'label.update', { id: l, name: 'feat' });
    expect(await tx.get('labels', l)).toMatchObject({ name: 'feat', color: '#f00' });
    expect(await code(run(tx, 'label.update', { id: id(), name: 'x' }))).toBe('not_found');
    await run(tx, 'task.addLabel', { id: id(), taskId: t, labelId: l });
    await run(tx, 'label.delete', { id: l });
    expect(await tx.scan('taskLabels')).toEqual([]);
    expect(await tx.get('labels', l)).toBeUndefined();
    expect(await code(run(tx, 'label.delete', { id: l }))).toBe('not_found');
  });
});
