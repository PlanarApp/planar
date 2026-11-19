import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractSchemas, SYNC_TASKS_MAX, uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { ORIGIN, loginCookie } from '../auth.js';
import {
  TestClient,
  dbUrl,
  key,
  mkUser,
  newDb,
  services,
  taskArgs,
  world,
  type World,
} from './helpers.js';

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
let kept: TestClient;
let taskId: string; // inheriting project: comment + reaction
let emptyTaskId: string; // inheriting project, no comments
let hiddenTaskId: string; // custom project without member/kept-outsider
let commentId: string;
let cookies: Record<'member' | 'outsider' | 'kept', string>;

const body = { type: 'doc', content: [{ type: 'paragraph' }] };

beforeAll(async () => {
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  w = await world(db);
  kept = new TestClient(services(db), await mkUser(db));
  await w.admin.ok('member.add', {
    id: uuidv7(),
    spaceId: w.spaceId,
    userId: kept.userId,
    role: 'member',
  });
  const t = taskArgs(w);
  taskId = t.id;
  await w.admin.ok('task.create', t);
  const e = taskArgs(w);
  emptyTaskId = e.id;
  await w.admin.ok('task.create', e);
  commentId = uuidv7();
  await w.admin.ok('comment.create', { id: commentId, taskId, body });
  await w.member.ok('reaction.toggle', { id: uuidv7(), commentId, emoji: '👍' });
  // a custom project: only kept (and the space admin) see it
  const hiddenProjectId = uuidv7();
  await w.admin.ok('project.create', {
    id: hiddenProjectId,
    spaceId: w.spaceId,
    name: 'Hidden',
    key: key(),
    rank: 'a1',
  });
  const h = taskArgs(w, { projectId: hiddenProjectId });
  hiddenTaskId = h.id;
  await w.admin.ok('task.create', h);
  await w.admin.ok('comment.create', { id: uuidv7(), taskId: hiddenTaskId, body });
  await w.admin.ok('project.setMembersMode', {
    projectId: hiddenProjectId,
    mode: 'custom',
    members: [{ id: uuidv7(), userId: kept.userId, role: 'member' }],
  });
  cookies = {
    member: await loginCookie(db, w.member.userId),
    outsider: await loginCookie(db, w.outsider.userId),
    kept: await loginCookie(db, kept.userId),
  };
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

const post = (payload: unknown, cookie?: string) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/sync/tasks',
      headers: { ...(cookie && { cookie }), origin: ORIGIN },
      payload: payload as object,
    });

const byTask = (json: { tasks: { taskId: string }[] }) =>
  Object.fromEntries(json.tasks.map((t) => [t.taskId, t])) as Record<
    string,
    Record<string, unknown>
  >;

describe('POST /sync/tasks', () => {
  it('без входа → 401', async () => {
    const r = await post({ protocol: 3, ids: [taskId] });
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('unauthenticated');
  });

  it('ids не 1–100 уникальных uuid или без protocol → 400 invalid_request', async () => {
    const many = Array.from({ length: SYNC_TASKS_MAX + 1 }, () => uuidv7());
    for (const p of [
      { protocol: 3, ids: many },
      { protocol: 3, ids: [] },
      { protocol: 3, ids: [taskId, taskId] },
      { protocol: 3, ids: ['x'] },
      { ids: [taskId] },
    ]) {
      const r = await post(p, cookies.member);
      expect(r.statusCode, JSON.stringify(p).slice(0, 80)).toBe(400);
      expect(r.json().code).toBe('invalid_request');
    }
    const ok = await post(
      { protocol: 3, ids: Array.from({ length: SYNC_TASKS_MAX }, () => uuidv7()) },
      cookies.member,
    );
    expect(ok.statusCode).toBe(200);
  });

  it('protocol < 3 → 426 upgrade_required', async () => {
    const r = await post({ protocol: 2, ids: [taskId] }, cookies.member);
    expect(r.statusCode).toBe(426);
    expect(r.json().code).toBe('upgrade_required');
  });

  it('участник: детали видимых задач, forbidden для скрытой, not_found для несуществующей, cursor', async () => {
    const missing = uuidv7();
    const r = await post(
      { protocol: 3, ids: [taskId, emptyTaskId, hiddenTaskId, missing] },
      cookies.member,
    );
    expect(r.statusCode).toBe(200);
    const json = r.json();
    expect(contractSchemas['sync.tasksResponse'].safeParse(json).success).toBe(true);
    const pull = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/sync/pull?cursor=0&clientId=${uuidv7()}`,
        headers: { cookie: cookies.member, origin: ORIGIN },
      });
    expect(json.cursor).toBeGreaterThan(0);
    expect(json.cursor).toBeLessThanOrEqual(pull.json().cursor);
    const t = byTask(json);
    expect(json.tasks).toHaveLength(4);
    expect(t[taskId]).toMatchObject({ status: 'ok' });
    expect((t[taskId]!.comments as { id: string }[]).map((c) => c.id)).toEqual([commentId]);
    expect(t[taskId]!.commentReactions).toEqual([
      expect.objectContaining({ commentId, userId: w.member.userId, emoji: '👍' }),
    ]);
    expect(t[emptyTaskId]).toEqual({
      taskId: emptyTaskId,
      status: 'ok',
      comments: [],
      commentReactions: [],
    });
    expect(t[hiddenTaskId]).toEqual({ taskId: hiddenTaskId, status: 'forbidden' });
    expect(t[missing]).toEqual({ taskId: missing, status: 'not_found' });
  });

  it('участник custom-проекта видит детали его задачи', async () => {
    const r = await post({ protocol: 3, ids: [hiddenTaskId] }, cookies.kept);
    expect(r.statusCode).toBe(200);
    const [t] = r.json().tasks;
    expect(t).toMatchObject({ taskId: hiddenTaskId, status: 'ok' });
    expect(t.comments).toHaveLength(1);
  });

  it('посторонний (не в пространстве) — forbidden, детали не отдаются', async () => {
    const r = await post({ protocol: 3, ids: [taskId] }, cookies.outsider);
    expect(r.statusCode).toBe(200);
    expect(r.json().tasks).toEqual([{ taskId, status: 'forbidden' }]);
  });
});
