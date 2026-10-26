import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import {
  mkUser,
  newDb,
  services,
  TestClient,
  taskArgs,
  world,
  type World,
} from '../sync/helpers.js';

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
  const ia = new TestClient(services(db), await mkUser(db, 'admin'));
  await ia.ok('settings.set', { id: 'enabled_modules', value: ['docs'] });
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
    expect(await docNotes(w.member)).toHaveLength(0); // автор себя не уведомляет
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
    await w.member.ok('docs.page.restore', { id: b });
    expect(await row(b)).toMatchObject({ archivedAt: null, parentId: null });
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
