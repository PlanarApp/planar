import { describe, expect, it } from 'vitest';
import { code, ctx, id, mem, run, seedSpace, seedTask, T1, U1, U2 } from './helpers';

const setup = async () => {
  const tx = mem();
  const s = await seedSpace(tx);
  return { tx, s, t: await seedTask(tx, s) };
};

it('reaction.toggle: создаёт, снимает, comment.delete чистит', async () => {
  const { tx, t } = await setup();
  const cm = id();
  await run(tx, 'comment.create', { id: cm, taskId: t, body: { type: 'doc' } });
  await run(tx, 'reaction.toggle', { id: id(), commentId: cm, emoji: '👍' });
  expect(await tx.scan('commentReactions')).toMatchObject([{ commentId: cm, userId: U1 }]);
  await run(tx, 'reaction.toggle', { id: id(), commentId: cm, emoji: '👍' });
  expect(await tx.scan('commentReactions')).toEqual([]);
  await run(tx, 'reaction.toggle', { id: id(), commentId: cm, emoji: '🎉' });
  expect(await code(run(tx, 'reaction.toggle', { id: id(), commentId: id(), emoji: 'x' }))).toBe(
    'not_found',
  );
  await run(tx, 'comment.delete', { id: cm });
  expect(await tx.scan('commentReactions')).toEqual([]);
});

describe('reaction.toggle', () => {
  const mk = async () => {
    const { tx, t } = await setup();
    const cm = id();
    await run(tx, 'comment.create', { id: cm, taskId: t, body: { type: 'doc' } });
    return { tx, cm };
  };
  it('spaceId из комментария', async () => {
    const { tx, cm } = await mk();
    await run(tx, 'reaction.toggle', { id: id(), commentId: cm, emoji: 'a' });
    const [r] = await tx.scan('commentReactions');
    expect(r!.spaceId).toBe((await tx.get('comments', cm))!.spaceId);
  });
  it('разные эмодзи сосуществуют', async () => {
    const { tx, cm } = await mk();
    for (const emoji of ['a', 'b'])
      await run(tx, 'reaction.toggle', { id: id(), commentId: cm, emoji });
    expect(await tx.scan('commentReactions')).toHaveLength(2);
  });
  it('реакция другого пользователя не снимается', async () => {
    const { tx, cm } = await mk();
    await run(tx, 'reaction.toggle', { id: id(), commentId: cm, emoji: 'a' });
    await run(tx, 'reaction.toggle', { id: id(), commentId: cm, emoji: 'a' }, ctx(U2));
    expect(await tx.scan('commentReactions')).toHaveLength(2);
  });
});

describe('отсутствующая задача', () => {
  it('unassign → not_found', async () => {
    expect(await code(run(mem(), 'task.unassign', { taskId: id(), userId: U1 }))).toBe('not_found');
  });
  it('unwatch → not_found', async () => {
    expect(await code(run(mem(), 'task.unwatch', { taskId: id() }))).toBe('not_found');
  });
  it('removeLabel → not_found', async () => {
    expect(await code(run(mem(), 'task.removeLabel', { taskId: id(), labelId: id() }))).toBe(
      'not_found',
    );
  });
});

describe('task.create', () => {
  it('значения по умолчанию, spaceId из проекта', async () => {
    const { tx, s, t } = await setup();
    expect(await tx.get('tasks', t)).toMatchObject({
      spaceId: s.spaceId,
      number: null,
      priority: 0,
      fields: {},
      parentId: null,
      description: null,
      dueDate: null,
      createdBy: U1,
      completedAt: null,
      createdAt: ctx().now,
    });
  });

  it('статус done → completedAt = now; assignees и labels создаются', async () => {
    const { tx, s } = await setup();
    const l = id();
    await run(tx, 'label.create', { id: l, spaceId: s.spaceId, name: 'b', color: '#000' });
    const t = await seedTask(tx, s, {
      statusId: s.statusIds[3],
      priority: 4,
      dueDate: '2026-11-01',
      assignees: [{ id: id(), userId: U2 }],
      labels: [{ id: id(), labelId: l }],
    });
    expect(await tx.get('tasks', t)).toMatchObject({
      completedAt: ctx().now,
      priority: 4,
      dueDate: '2026-11-01',
    });
    expect(await tx.scan('taskAssignees', { index: 'taskId', eq: t })).toMatchObject([
      { userId: U2, spaceId: s.spaceId },
    ]);
    expect(await tx.scan('taskLabels', { index: 'taskId', eq: t })).toMatchObject([{ labelId: l }]);
  });

  it('невалидные args и ссылки', async () => {
    const { tx, s } = await setup();
    const a = {
      id: id(),
      projectId: s.projectId,
      statusId: s.statusIds[0],
      title: 'x',
      rank: 'a1',
    };
    await expect(run(tx, 'task.create', { ...a, title: '' })).rejects.toThrow();
    await expect(run(tx, 'task.create', { ...a, priority: 5 })).rejects.toThrow();
    await expect(run(tx, 'task.create', { ...a, dueDate: '2026-13-01' })).rejects.toThrow();
    expect(await code(run(tx, 'task.create', { ...a, projectId: id() }))).toBe('not_found');
    expect(await code(run(tx, 'task.create', { ...a, statusId: id() }))).toBe('not_found');
    expect(await code(run(tx, 'task.create', { ...a, parentId: id() }))).toBe('not_found');
    const s2 = await seedSpace(tx);
    expect(await code(run(tx, 'task.create', { ...a, statusId: s2.statusIds[0] }))).toBe(
      'invalid_args',
    );
    const t2 = await seedTask(tx, s2);
    expect(await code(run(tx, 'task.create', { ...a, parentId: t2 }))).toBe('invalid_args');
    expect(await code(run(tx, 'task.create', { ...a, parentId: a.id }))).toBe('not_found');
    const l2 = id();
    await run(tx, 'label.create', { id: l2, spaceId: s2.spaceId, name: 'b', color: '#000' });
    expect(await code(run(tx, 'task.create', { ...a, labels: [{ id: id(), labelId: l2 }] }))).toBe(
      'invalid_args',
    );
    expect(await tx.get('tasks', a.id)).toBeUndefined();
  });
});

describe('task.update', () => {
  it('пишет только переданные поля + updatedAt; null обнуляет', async () => {
    const { tx, t } = await setup();
    await run(
      tx,
      'task.update',
      { id: t, title: 'N', dueDate: '2026-11-01', fields: { a: 1 } },
      ctx(U1, T1),
    );
    await run(tx, 'task.update', { id: t, dueDate: null, description: null });
    expect(await tx.get('tasks', t)).toMatchObject({
      title: 'N',
      dueDate: null,
      fields: { a: 1 },
      priority: 0,
    });
    expect(await code(run(tx, 'task.update', { id: id(), title: 'x' }))).toBe('not_found');
  });

  it('completedAt: в done — now, повторно done — прежнее, из done — null', async () => {
    const { tx, s, t } = await setup();
    await run(tx, 'task.update', { id: t, statusId: s.statusIds[3] });
    expect((await tx.get('tasks', t))!.completedAt).toBe(ctx().now);
    await run(tx, 'task.update', { id: t, statusId: s.statusIds[4] }, ctx(U1, T1));
    expect((await tx.get('tasks', t))!.completedAt).toBe(ctx().now);
    await run(tx, 'task.update', { id: t, statusId: s.statusIds[2] }, ctx(U1, T1));
    expect((await tx.get('tasks', t))!.completedAt).toBeNull();
  });

  it('смена projectId: number = null; другое пространство → invalid_args', async () => {
    const { tx, s, t } = await setup();
    await tx.patch('tasks', t, { number: 7 });
    await run(tx, 'task.update', { id: t, projectId: s.projectId });
    expect((await tx.get('tasks', t))!.number).toBe(7);
    const p2 = id();
    await run(tx, 'project.create', {
      id: p2,
      spaceId: s.spaceId,
      name: 'P2',
      key: 'PTWO',
      rank: 'a1',
    });
    await run(tx, 'task.update', { id: t, projectId: p2 });
    expect(await tx.get('tasks', t)).toMatchObject({ projectId: p2, number: null });
    const s2 = await seedSpace(tx);
    expect(await code(run(tx, 'task.update', { id: t, projectId: s2.projectId }))).toBe(
      'invalid_args',
    );
    expect(await code(run(tx, 'task.update', { id: t, statusId: s2.statusIds[0] }))).toBe(
      'invalid_args',
    );
    expect(await code(run(tx, 'task.update', { id: t, projectId: id() }))).toBe('not_found');
    expect(await code(run(tx, 'task.update', { id: t, statusId: id() }))).toBe('not_found');
  });

  it('parentId: не сама задача и не потомок; другое пространство; null снимает', async () => {
    const { tx, s, t } = await setup();
    const c = await seedTask(tx, s, { parentId: t });
    const g = await seedTask(tx, s, { parentId: c });
    expect(await code(run(tx, 'task.update', { id: t, parentId: t }))).toBe('invalid_args');
    expect(await code(run(tx, 'task.update', { id: t, parentId: g }))).toBe('invalid_args');
    expect(await code(run(tx, 'task.update', { id: g, parentId: id() }))).toBe('not_found');
    const other = await seedTask(tx, await seedSpace(tx));
    expect(await code(run(tx, 'task.update', { id: g, parentId: other }))).toBe('invalid_args');
    await run(tx, 'task.update', { id: g, parentId: t });
    expect((await tx.get('tasks', g))!.parentId).toBe(t);
    await run(tx, 'task.update', { id: g, parentId: null });
    expect((await tx.get('tasks', g))!.parentId).toBeNull();
  });
});

describe('task.delete и связи', () => {
  it('удаляет подзадачи и все дочерние строки', async () => {
    const { tx, s, t } = await setup();
    const c = await seedTask(tx, s, { parentId: t });
    const l = id();
    await run(tx, 'label.create', { id: l, spaceId: s.spaceId, name: 'b', color: '#000' });
    for (const x of [t, c]) {
      await run(tx, 'task.assign', { id: id(), taskId: x, userId: U2 });
      await run(tx, 'task.watch', { id: id(), taskId: x });
      await run(tx, 'task.addLabel', { id: id(), taskId: x, labelId: l });
      await run(tx, 'checklist.add', { id: id(), taskId: x, text: 'i', rank: 'a0' });
      const cm = id();
      await run(tx, 'comment.create', { id: cm, taskId: x, body: { type: 'doc' } });
      await run(tx, 'attachment.create', {
        id: id(),
        taskId: x,
        commentId: cm,
        fileSha256: 'h',
        name: 'n',
        mime: 'm',
        size: 1,
      });
      await run(tx, 'reaction.toggle', { id: id(), commentId: cm, emoji: '👍' });
    }
    await run(tx, 'task.delete', { id: t });
    for (const e of [
      'tasks',
      'taskAssignees',
      'taskWatchers',
      'taskLabels',
      'checklistItems',
      'comments',
      'commentReactions',
      'attachments',
    ] as const)
      expect(await tx.scan(e)).toEqual([]);
    expect(await tx.get('labels', l)).toBeDefined();
    expect(await code(run(tx, 'task.delete', { id: t }))).toBe('not_found');
  });

  it('assign: идемпотентно; unassign; not_found', async () => {
    const { tx, t } = await setup();
    await run(tx, 'task.assign', { id: id(), taskId: t, userId: U2 });
    await run(tx, 'task.assign', { id: id(), taskId: t, userId: U2 });
    expect(await tx.scan('taskAssignees')).toHaveLength(1);
    expect(await code(run(tx, 'task.assign', { id: id(), taskId: id(), userId: U2 }))).toBe(
      'not_found',
    );
    await run(tx, 'task.unassign', { taskId: t, userId: U1 });
    expect(await tx.scan('taskAssignees')).toHaveLength(1);
    await run(tx, 'task.unassign', { taskId: t, userId: U2 });
    expect(await tx.scan('taskAssignees')).toEqual([]);
  });

  it('watch/unwatch: только себя, идемпотентно', async () => {
    const { tx, t } = await setup();
    await run(tx, 'task.watch', { id: id(), taskId: t });
    await run(tx, 'task.watch', { id: id(), taskId: t });
    await run(tx, 'task.watch', { id: id(), taskId: t }, ctx(U2));
    expect(await tx.scan('taskWatchers')).toHaveLength(2);
    expect(await code(run(tx, 'task.watch', { id: id(), taskId: id() }))).toBe('not_found');
    await run(tx, 'task.unwatch', { taskId: t });
    expect(await tx.scan('taskWatchers')).toMatchObject([{ userId: U2 }]);
  });

  it('addLabel/removeLabel: метка того же пространства, идемпотентно', async () => {
    const { tx, s, t } = await setup();
    const l = id();
    await run(tx, 'label.create', { id: l, spaceId: s.spaceId, name: 'b', color: '#000' });
    await run(tx, 'task.addLabel', { id: id(), taskId: t, labelId: l });
    await run(tx, 'task.addLabel', { id: id(), taskId: t, labelId: l });
    expect(await tx.scan('taskLabels')).toHaveLength(1);
    const s2 = await seedSpace(tx);
    const l2 = id();
    await run(tx, 'label.create', { id: l2, spaceId: s2.spaceId, name: 'b', color: '#000' });
    expect(await code(run(tx, 'task.addLabel', { id: id(), taskId: t, labelId: l2 }))).toBe(
      'invalid_args',
    );
    expect(await code(run(tx, 'task.addLabel', { id: id(), taskId: t, labelId: id() }))).toBe(
      'not_found',
    );
    expect(await code(run(tx, 'task.addLabel', { id: id(), taskId: id(), labelId: l }))).toBe(
      'not_found',
    );
    await run(tx, 'task.removeLabel', { taskId: t, labelId: l });
    expect(await tx.scan('taskLabels')).toEqual([]);
  });

  it('checklist: add/update/delete', async () => {
    const { tx, t } = await setup();
    const c = id();
    await run(tx, 'checklist.add', { id: c, taskId: t, text: 'a', rank: 'a0' });
    expect(await tx.get('checklistItems', c)).toMatchObject({ done: false, text: 'a' });
    expect(
      await code(run(tx, 'checklist.add', { id: id(), taskId: id(), text: 'a', rank: 'a0' })),
    ).toBe('not_found');
    await run(tx, 'checklist.update', { id: c, done: true });
    expect(await tx.get('checklistItems', c)).toMatchObject({ done: true, text: 'a' });
    expect(await code(run(tx, 'checklist.update', { id: id(), done: true }))).toBe('not_found');
    await run(tx, 'checklist.delete', { id: c });
    expect(await tx.get('checklistItems', c)).toBeUndefined();
  });
});
