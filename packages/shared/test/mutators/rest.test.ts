import { describe, expect, it } from 'vitest';
import { createRegistry, domainMutators, extractMentions, textToDoc } from '../../src/index';
import { code, ctx, doc, id, mem, run, seedSpace, seedTask, T1, U1, U2 } from './helpers';

const mention = (uid: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: uid } }] }],
});

describe('comment/attachment', () => {
  it('comment.create: автор, mentions из body; not_found', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const t = await seedTask(tx, s);
    const c = id();
    await run(tx, 'comment.create', { id: c, taskId: t, body: mention(U2) });
    expect(await tx.get('comments', c)).toMatchObject({
      authorId: U1,
      mentions: [U2],
      editedAt: null,
      spaceId: s.spaceId,
    });
    expect(await code(run(tx, 'comment.create', { id: id(), taskId: id(), body: doc() }))).toBe(
      'not_found',
    );
    await expect(
      run(tx, 'comment.create', { id: id(), taskId: t, body: { type: 'x' } }),
    ).rejects.toThrow();
  });

  it('comment.update: только автор, editedAt, mentions пересчитаны', async () => {
    const tx = mem();
    const t = await seedTask(tx, await seedSpace(tx));
    const c = id();
    await run(tx, 'comment.create', { id: c, taskId: t, body: mention(U2) });
    expect(await code(run(tx, 'comment.update', { id: c, body: doc() }, ctx(U2)))).toBe(
      'forbidden',
    );
    await run(tx, 'comment.update', { id: c, body: doc('new') }, ctx(U1, T1));
    expect(await tx.get('comments', c)).toMatchObject({
      mentions: [],
      editedAt: T1,
      updatedAt: T1,
    });
    expect(await code(run(tx, 'comment.update', { id: id(), body: doc() }))).toBe('not_found');
  });

  it('comment.delete: только автор, удаляет вложения комментария', async () => {
    const tx = mem();
    const t = await seedTask(tx, await seedSpace(tx));
    const c = id();
    await run(tx, 'comment.create', { id: c, taskId: t, body: doc() });
    const at = { fileSha256: 'h', name: 'n', mime: 'm', size: 1 };
    const a1 = id();
    const a2 = id();
    await run(tx, 'attachment.create', { id: a1, taskId: t, commentId: c, ...at });
    await run(tx, 'attachment.create', { id: a2, taskId: t, ...at });
    expect(await code(run(tx, 'comment.delete', { id: c }, ctx(U2)))).toBe('forbidden');
    await run(tx, 'comment.delete', { id: c });
    expect(await tx.get('comments', c)).toBeUndefined();
    expect(await tx.get('attachments', a1)).toBeUndefined();
    expect(await tx.get('attachments', a2)).toBeDefined();
    expect(await code(run(tx, 'comment.delete', { id: c }))).toBe('not_found');
  });

  it('attachment.create/delete', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const t = await seedTask(tx, s);
    const t2 = await seedTask(tx, s);
    const at = { fileSha256: 'h', name: 'n', mime: 'image/png', size: 3, width: 1, height: 2 };
    const a = id();
    await run(tx, 'attachment.create', { id: a, taskId: t, ...at });
    expect(await tx.get('attachments', a)).toMatchObject({
      ...at,
      commentId: null,
      uploadedBy: U1,
      spaceId: s.spaceId,
    });
    expect(await code(run(tx, 'attachment.create', { id: id(), taskId: id(), ...at }))).toBe(
      'not_found',
    );
    expect(
      await code(run(tx, 'attachment.create', { id: id(), taskId: t, commentId: id(), ...at })),
    ).toBe('not_found');
    const c = id();
    await run(tx, 'comment.create', { id: c, taskId: t2, body: doc() });
    expect(
      await code(run(tx, 'attachment.create', { id: id(), taskId: t, commentId: c, ...at })),
    ).toBe('invalid_args');
    await run(tx, 'attachment.delete', { id: a });
    await run(tx, 'attachment.delete', { id: a });
    expect(await tx.get('attachments', a)).toBeUndefined();
  });
});

describe('notification/view/settings', () => {
  const notif = (userId: string, spaceId: string, taskId: string) => ({
    id: id(),
    userId,
    spaceId,
    kind: 'assigned' as const,
    taskId,
    url: null,
    body: null,
    commentId: null,
    actorId: U2,
    readAt: null,
    createdAt: ctx().now,
  });

  it('notification.read/delete: только свои', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const t = await seedTask(tx, s);
    const mine = notif(U1, s.spaceId, t);
    const theirs = notif(U2, s.spaceId, t);
    await tx.put('notifications', mine);
    await tx.put('notifications', theirs);
    expect(
      await code(run(tx, 'notification.read', { ids: [mine.id, theirs.id] }, ctx(U1, T1))),
    ).toBe('forbidden');
    expect((await tx.get('notifications', mine.id))!.readAt).toBeNull();
    await run(tx, 'notification.read', { ids: [mine.id, id()] }, ctx(U1, T1));
    expect((await tx.get('notifications', mine.id))!.readAt).toBe(T1);
    expect(await code(run(tx, 'notification.delete', { ids: [theirs.id] }))).toBe('forbidden');
    await run(tx, 'notification.delete', { ids: [mine.id] });
    expect(await tx.get('notifications', mine.id)).toBeUndefined();
    expect(await tx.get('notifications', theirs.id)).toBeDefined();
  });

  it('view.create/update/delete', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const v = {
      id: id(),
      spaceId: s.spaceId,
      personal: true,
      name: 'v',
      layout: 'board',
      filter: { a: 1 },
      config: {},
      rank: 'a0',
    };
    await run(tx, 'view.create', v);
    const shared = id();
    await run(tx, 'view.create', { ...v, id: shared, personal: false });
    expect(await tx.get('savedViews', v.id)).toMatchObject({
      userId: U1,
      createdBy: U1,
      filter: { a: 1 },
    });
    expect((await tx.get('savedViews', shared))!.userId).toBeNull();
    // a node's view — always personal; the node format is checked
    const nodeView = id();
    const node = `p:${id()}:me-assigned`;
    await run(tx, 'view.create', { ...v, id: nodeView, personal: false, node });
    expect(await tx.get('savedViews', nodeView)).toMatchObject({ userId: U1, node });
    expect((await tx.get('savedViews', v.id))!.node).toBeNull();
    await expect(run(tx, 'view.create', { ...v, id: id(), node: 'x:1' })).rejects.toThrow(/node/);
    expect(await code(run(tx, 'view.create', { ...v, id: id(), spaceId: id() }))).toBe('not_found');
    await run(tx, 'view.update', { id: v.id, name: 'w', filter: {} });
    expect(await tx.get('savedViews', v.id)).toMatchObject({
      name: 'w',
      layout: 'board',
      filter: {},
    });
    expect(await code(run(tx, 'view.update', { id: id(), name: 'w' }))).toBe('not_found');
    await run(tx, 'view.delete', { id: v.id });
    expect(await tx.get('savedViews', v.id)).toBeUndefined();
  });

  it('settings.set: вставка и замена', async () => {
    const tx = mem();
    await run(tx, 'settings.set', { id: 'k', value: { a: [1] } });
    await run(tx, 'settings.set', { id: 'k', value: null }, ctx(U1, T1));
    expect(await tx.get('settings', 'k')).toEqual({ id: 'k', value: null, updatedAt: T1 });
    await expect(run(tx, 'settings.set', { id: 'k' })).rejects.toThrow();
  });
});

describe('text', () => {
  it('textToDoc/extractMentions', () => {
    const d = textToDoc('hi @bob and @nobody\n\n@alice', [
      { id: U1, login: 'alice' },
      { id: U2, login: 'bob' },
    ]);
    expect(d.content).toHaveLength(3);
    expect(d.content[1]).toEqual({ type: 'paragraph' });
    expect(extractMentions(d)).toEqual([U2, U1]);
    expect(extractMentions(textToDoc('@bob @bob', [{ id: U2, login: 'bob' }]))).toEqual([U2]);
    expect(extractMentions(doc())).toEqual([]);
  });
});

describe('детерминизм', () => {
  it('один сценарий на двух MemoryTx даёт одинаковое состояние', async () => {
    const ids = {
      sp: id(),
      m: id(),
      st: [id(), id(), id(), id(), id()],
      p: id(),
      t: id(),
      c: id(),
    };
    const play = async () => {
      const tx = mem();
      await run(tx, 'space.create', {
        id: ids.sp,
        name: 'S',
        rank: 'a0',
        memberId: ids.m,
      });
      await run(tx, 'project.create', {
        id: ids.p,
        spaceId: ids.sp,
        name: 'P',
        key: 'PRJ',
        rank: 'a0',
        statusIds: ids.st,
      });
      await run(tx, 'task.create', {
        id: ids.t,
        projectId: ids.p,
        statusId: ids.st[3],
        title: 'T',
        rank: 'a0',
      });
      await run(tx, 'comment.create', { id: ids.c, taskId: ids.t, body: mention(U2) });
      await run(tx, 'task.update', { id: ids.t, title: 'U' }, ctx(U1, T1));
      return Promise.all(
        ['spaces', 'spaceMembers', 'statuses', 'projects', 'tasks', 'comments'].map((e) =>
          tx.scan(e as 'spaces'),
        ),
      );
    };
    const [a, b] = [await play(), await play()];
    expect(a).toEqual(b);
    expect(domainMutators.length).toBe(61);
  });
});

describe('реестр и аргументы', () => {
  it('createRegistry принимает domainMutators без дублей', () => {
    expect(createRegistry(domainMutators).size).toBe(61);
  });

  it.each(domainMutators.map((d) => d.name))('%s: пустые args отклоняются', async (name) => {
    await expect(run(mem(), name, {})).rejects.toThrow();
  });

  const missing = [
    ['task.watch', { id: id() }],
    ['task.assign', { id: id(), userId: U2 }],
    ['task.addLabel', { id: id(), labelId: id() }],
    ['checklist.add', { id: id(), text: 't', rank: 'a0' }],
    ['comment.create', { id: id(), body: doc() }],
    ['attachment.create', { id: id(), fileSha256: 'h', name: 'n', mime: 'm', size: 1 }],
  ] as const;
  it.each(missing)('%s: нет задачи → not_found', async (name, args) => {
    expect(await code(run(mem(), name, { ...args, taskId: id() }))).toBe('not_found');
  });

  it.each([
    ['label.create', { name: 'l', color: '#000' }],
    ['status.create', { name: 's', category: 'todo', color: '#000', rank: 'a0' }],
  ] as const)('%s: нет проекта → not_found', async (name, args) => {
    expect(await code(run(mem(), name, { ...args, id: id(), projectId: id() }))).toBe('not_found');
  });

  const noSpace = [
    [
      'project.create',
      { name: 'p', key: 'PP', rank: 'a0', statusIds: [id(), id(), id(), id(), id()] },
    ],
    ['member.add', { userId: U2, role: 'member' }],
    [
      'view.create',
      { personal: false, name: 'v', layout: 'l', filter: {}, config: {}, rank: 'a0' },
    ],
  ] as const;
  it.each(noSpace)('%s: нет пространства → not_found', async (name, args) => {
    expect(await code(run(mem(), name, { ...args, id: id(), spaceId: id() }))).toBe('not_found');
  });
});
