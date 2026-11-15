import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { newDb, services, TestClient, taskArgs, world, type World } from '../sync/helpers.js';

type R = Record<string, unknown> & { id: string; archivedAt: string | null };
const db = newDb();
let w: World;
const body = (text: string, sha?: string) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text }] },
    ...(sha ? [{ type: 'image', attrs: { src: `/files/${sha}` } }] : []),
  ],
});
const pg = (over: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  spaceId: w.spaceId,
  rank: 'a0',
  ...over,
});
const rows = async (c: TestClient, e: string) =>
  ((await c.bootstrap()).data as Record<string, R[]>)[e] ?? [];
const row = async (id: string) => (await rows(w.admin, 'docsPages')).find((r) => r.id === id)!;
const mk = async (over: Record<string, unknown> = {}) => {
  const a = pg(over);
  await w.member.ok('docs.page.create', a);
  return a.id;
};

beforeAll(async () => {
  w = await world(db);
  // PJ-3: docs is a data module — on per project (world() enables it), enabled_modules holds only shared ones
});
afterAll(() => db.$client.end());

describe('docs', () => {
  it('create: text и files считаются, createdBy = автор', async () => {
    const sha = 'a'.repeat(64);
    const id = await mk({ title: 'T', body: body('hello world', sha) });
    expect(await row(id)).toMatchObject({
      title: 'T',
      text: 'hello world',
      files: [sha],
      createdBy: w.member.userId,
      parentId: null,
    });
  });

  it('права: guest не пишет, чужой не пишет и не видит', async () => {
    expect(await w.guest.push('docs.page.create', pg())).toMatchObject({ code: 'forbidden' });
    expect(await w.outsider.push('docs.page.create', pg())).toMatchObject({ code: 'forbidden' });
    const id = await mk();
    expect(await rows(w.outsider, 'docsPages')).toEqual([]);
    expect((await w.guest.bootstrap()).data.docsPages!.some((r) => r.id === id)).toBe(true);
    const { cursor } = await w.outsider.bootstrap();
    await mk();
    expect((await w.outsider.pull(cursor)).changes.map((c) => c.entity)).not.toContain('docsPages');
  });

  it('create: родитель из другого пространства / архивный → invalid_args', async () => {
    expect(await w.member.push('docs.page.create', pg({ parentId: uuidv7() }))).toMatchObject({
      code: 'invalid_args',
    });
    const p = await mk();
    await w.member.ok('docs.page.archive', { id: p });
    expect(await w.member.push('docs.page.create', pg({ parentId: p }))).toMatchObject({
      code: 'invalid_args',
    });
  });

  it('projectId: свой проект ок, чужой → invalid_args; дети и перенос наследуют группу', async () => {
    const other = await world(db);
    expect(
      await w.member.push('docs.page.create', pg({ projectId: other.projectId })),
    ).toMatchObject({ code: 'invalid_args' });
    const root = await mk({ projectId: w.projectId });
    const kid = await mk({ parentId: root, projectId: null });
    expect(await row(kid)).toMatchObject({ projectId: w.projectId });
    const loose = await mk();
    const sub = await mk({ parentId: loose });
    expect(await row(loose)).toMatchObject({ projectId: null });
    await w.member.ok('docs.page.move', { id: loose, parentId: root, rank: 'b0' });
    expect(await row(sub)).toMatchObject({ projectId: w.projectId });
    await w.member.ok('docs.page.move', { id: loose, parentId: null, rank: 'b0', projectId: null });
    expect(await row(sub)).toMatchObject({ projectId: null });
  });

  it('упоминание на странице → doc_mention новым упомянутым, не автору и не задачам', async () => {
    const m = (id: string, kind?: string) => ({
      type: 'mention',
      attrs: { id, ...(kind && { kind }) },
    });
    const withMentions = (...nodes: unknown[]) => ({
      type: 'doc',
      content: [{ type: 'paragraph', content: nodes }],
    });
    const id = await mk({
      title: 'Ревью',
      body: withMentions(m(w.admin.userId), m(uuidv7(), 'task')),
    });
    await w.member.ok('docs.page.update', {
      id,
      body: withMentions(m(w.admin.userId), m(w.guest.userId), m(w.member.userId)),
    });
    const docNotes = async (c: TestClient) =>
      ((await c.bootstrap()).data.notifications ?? []).filter((n) => n.kind === 'doc_mention');
    expect(await docNotes(w.admin)).toMatchObject([{ url: `/m/docs/${id}`, spaceId: w.spaceId }]);
    expect(await docNotes(w.guest)).toHaveLength(1);
    expect(await docNotes(w.member)).toHaveLength(0); // the author does not notify themselves
  });

  it('update: пересчёт text, архивная → conflict', async () => {
    const id = await mk();
    await w.member.ok('docs.page.update', { id, body: body('new') });
    expect(await row(id)).toMatchObject({ text: 'new', updatedBy: w.member.userId });
    await w.member.ok('docs.page.archive', { id });
    expect(await w.member.push('docs.page.update', { id, title: 'x' })).toMatchObject({
      code: 'conflict',
    });
  });

  it('move: в себя и потомка → invalid_args, нормальный перенос', async () => {
    const a = await mk();
    const b = await mk({ parentId: a });
    const c = await mk({ parentId: b });
    const mv = (id: string, parentId: string | null) =>
      w.member.push('docs.page.move', { id, parentId, rank: 'a1' });
    expect(await mv(a, a)).toMatchObject({ code: 'invalid_args' });
    expect(await mv(a, c)).toMatchObject({ code: 'invalid_args' });
    expect(await mv(c, null)).toMatchObject({ ok: true });
    expect(await row(c)).toMatchObject({ parentId: null, rank: 'a1' });
  });

  it('archive помечает поддерево, restore снимает; архивный родитель → parentId null', async () => {
    const a = await mk();
    const b = await mk({ parentId: a });
    const c = await mk({ parentId: b });
    await w.member.ok('docs.page.archive', { id: b });
    expect((await row(c)).archivedAt).not.toBeNull();
    expect((await row(a)).archivedAt).toBeNull();
    expect(await w.member.push('docs.page.move', { id: c, parentId: a, rank: 'a0' })).toMatchObject(
      {
        code: 'conflict',
      },
    );
    await w.member.ok('docs.page.archive', { id: a });
    expect(await row(a)).toMatchObject({ archivedBy: w.member.userId });
    // PLNRAPP-154: restore — admin of the project / space / instance only
    expect(await w.member.push('docs.page.restore', { id: b })).toMatchObject({
      code: 'forbidden',
    });
    await w.admin.ok('docs.page.restore', { id: b });
    expect(await row(b)).toMatchObject({ archivedAt: null, archivedBy: null, parentId: null });
    expect((await row(c)).archivedAt).toBeNull();
  });

  it('link: чужая задача → invalid_args, повтор пары без дубля, remove', async () => {
    const p = await mk();
    const task = taskArgs(w);
    await w.member.ok('task.create', task);
    await w.member.ok('docs.link.add', { id: uuidv7(), pageId: p, taskId: task.id });
    await w.member.ok('docs.link.add', { id: uuidv7(), pageId: p, taskId: task.id });
    expect(await rows(w.member, 'docsTaskLinks')).toHaveLength(1);
    expect(
      await w.member.push('docs.link.add', { id: uuidv7(), pageId: p, taskId: uuidv7() }),
    ).toMatchObject({ code: 'invalid_args' });
    await w.member.ok('docs.link.remove', { pageId: p, taskId: task.id });
    await w.member.ok('docs.link.remove', { pageId: p, taskId: task.id });
    expect(await rows(w.member, 'docsTaskLinks')).toHaveLength(0);
  });

  it('lock: чужая действующая → conflict; своя перезахват; unlock чужой — ничего', async () => {
    const p = await mk();
    await w.member.ok('docs.lock', { pageId: p });
    await w.member.ok('docs.lock', { pageId: p });
    expect(await w.admin.push('docs.lock', { pageId: p })).toMatchObject({ code: 'conflict' });
    await w.admin.ok('docs.unlock', { pageId: p });
    expect(await rows(w.admin, 'docsLocks')).toHaveLength(1);
    await w.member.ok('docs.unlock', { pageId: p });
    expect(await rows(w.admin, 'docsLocks')).toHaveLength(0);
    await w.admin.ok('docs.lock', { pageId: p });
  });

  it('lock: два параллельных docs.lock разных пользователей — ровно один ok, второй conflict', async () => {
    const p = await mk();
    const rs = await Promise.all([
      w.member.push('docs.lock', { pageId: p }),
      w.admin.push('docs.lock', { pageId: p }),
    ]);
    expect(rs.filter((r) => r?.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r?.ok)).toEqual([expect.objectContaining({ code: 'conflict' })]);
    expect((await rows(w.admin, 'docsLocks')).filter((r) => r.id === p)).toHaveLength(1);
  });

  it('повтор push с тем же id мутации не дублирует строки', async () => {
    const svc = services(db);
    const clientId = uuidv7();
    const a = pg();
    const req = { clientId, mutations: [{ id: 1, name: 'docs.page.create', args: a }] };
    await svc.push.push(w.member.userId, req);
    await svc.push.push(w.member.userId, req);
    expect((await rows(w.member, 'docsPages')).filter((r) => r.id === a.id)).toHaveLength(1);
  });
});

// PLNRAPP-209: комментарии к странице — ветки, упоминания, назначение, закрытие; права как у страницы
describe('docs comments', () => {
  const say = (text: string, ...mentions: string[]) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text },
          ...mentions.map((id) => ({ type: 'mention', attrs: { id } })),
        ],
      },
    ],
  });
  const comments = async (c: TestClient, pageId: string) =>
    (await rows(c, 'docsComments')).filter((r) => r.pageId === pageId);
  const put = async (c: TestClient, pageId: string, over: Record<string, unknown> = {}) => {
    const id = uuidv7();
    await c.ok('docs.comment.create', { id, pageId, body: say('текст'), ...over });
    return id;
  };

  it('create: ветка и ответ, mentions из body; гость видит, но не пишет; чужой не видит', async () => {
    const p = await mk({ projectId: w.projectId });
    const root = await put(w.member, p, { body: say('смотри ', w.admin.userId) });
    const reply = await put(w.admin, p, { parentId: root });
    expect(await comments(w.admin, p)).toMatchObject([
      { id: root, parentId: null, authorId: w.member.userId, mentions: [w.admin.userId] },
      { id: reply, parentId: root, authorId: w.admin.userId, mentions: [] },
    ]);
    expect(await comments(w.guest, p)).toHaveLength(2);
    expect(
      await w.guest.push('docs.comment.create', { id: uuidv7(), pageId: p, body: say('x') }),
    ).toMatchObject({ code: 'forbidden' });
    expect(await rows(w.outsider, 'docsComments')).toEqual([]);
  });

  it('create: ответ на комментарий другой страницы → invalid_args, архивная страница → conflict', async () => {
    const a = await mk();
    const b = await mk();
    const c = await put(w.member, a);
    expect(
      await w.member.push('docs.comment.create', {
        id: uuidv7(),
        pageId: b,
        body: say('x'),
        parentId: c,
      }),
    ).toMatchObject({ code: 'invalid_args' });
    await w.member.ok('docs.page.archive', { id: b });
    expect(
      await w.member.push('docs.comment.create', { id: uuidv7(), pageId: b, body: say('x') }),
    ).toMatchObject({ code: 'conflict' });
  });

  it('update и delete — только автор; delete забирает ответы', async () => {
    const p = await mk();
    const root = await put(w.member, p);
    const reply = await put(w.admin, p, { parentId: root });
    await put(w.member, p, { parentId: reply });
    expect(
      await w.admin.push('docs.comment.update', { id: root, body: say('чужое') }),
    ).toMatchObject({ code: 'forbidden' });
    await w.member.ok('docs.comment.update', { id: root, body: say('новое ', w.guest.userId) });
    expect((await comments(w.member, p)).find((r) => r.id === root)).toMatchObject({
      mentions: [w.guest.userId],
      editedAt: expect.any(String),
    });
    expect(await w.admin.push('docs.comment.delete', { id: root })).toMatchObject({
      code: 'forbidden',
    });
    await w.member.ok('docs.comment.delete', { id: root });
    expect(await comments(w.member, p)).toEqual([]);
  });

  it('assign / resolve: гость не исполнитель; завершают исполнитель, автор или admin; переназначение открывает', async () => {
    const p = await mk({ projectId: w.projectId });
    const c = await put(w.member, p);
    expect(await w.member.push('docs.comment.resolve', { id: c, resolved: true })).toMatchObject({
      code: 'invalid_args',
    });
    expect(
      await w.member.push('docs.comment.assign', { id: c, assigneeId: w.guest.userId }),
    ).toMatchObject({ code: 'invalid_args' });
    await w.member.ok('docs.comment.assign', { id: c, assigneeId: w.admin.userId });
    await w.admin.ok('docs.comment.resolve', { id: c, resolved: true });
    expect((await comments(w.member, p))[0]).toMatchObject({
      assigneeId: w.admin.userId,
      resolvedBy: w.admin.userId,
      resolvedAt: expect.any(String),
    });
    await w.member.ok('docs.comment.assign', { id: c, assigneeId: w.member.userId });
    expect((await comments(w.member, p))[0]).toMatchObject({ resolvedAt: null, resolvedBy: null });

    const other = await put(w.admin, p, { assigneeId: w.admin.userId });
    expect(
      await w.member.push('docs.comment.resolve', { id: other, resolved: true }),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('уведомления: упомянутым — doc_mention, исполнителю — doc_comment_assigned, не автору', async () => {
    const p = await mk({ projectId: w.projectId, title: 'Спека' });
    const kinds = async (c: TestClient, kind: string) =>
      ((await c.bootstrap()).data.notifications ?? []).filter(
        (n) => n.kind === kind && n.url?.startsWith(`/m/docs/${p}?comment=`),
      );
    const c = await put(w.member, p, {
      body: say('глянь ', w.guest.userId, w.member.userId),
      assigneeId: w.admin.userId,
    });
    expect(await kinds(w.guest, 'doc_mention')).toMatchObject([
      { url: `/m/docs/${p}?comment=${c}`, taskId: null, actorId: w.member.userId },
    ]);
    expect(await kinds(w.member, 'doc_mention')).toEqual([]);
    expect(await kinds(w.admin, 'doc_comment_assigned')).toHaveLength(1);
    // the same mention again — no new notification
    await w.member.ok('docs.comment.update', { id: c, body: say('ещё ', w.guest.userId) });
    expect(await kinds(w.guest, 'doc_mention')).toHaveLength(1);
  });

  it('docs.page.delete удаляет комментарии страницы', async () => {
    const p = await mk();
    await put(w.member, p);
    await w.member.ok('docs.page.archive', { id: p });
    await w.admin.ok('docs.page.delete', { id: p });
    expect(await comments(w.admin, p)).toEqual([]);
  });
});
