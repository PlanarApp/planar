// PJ-11: project members — a user removed from a project gets none of its data (C-schema v17, C-mutators v14)
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { chatChannels } from '@planar/module-chat/api/schema';
import { docsPages } from '@planar/module-docs/api/schema';
import { createApp } from '../../src/app.js';
import * as schema from '../../src/db/schema.js';
import { RestService } from '../../src/rest/rest.service.js';
import { projectAccess } from '../../src/sync/project-access.js';
import { updateUser } from '../../src/users/users.repo.js';
import { viewersOf } from '../../src/sync/viewers.js';
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
} from '../sync/helpers.js';

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
/** space member removed from the project, a space member kept in it, an instance admin outside the space */
let removed: TestClient;
let kept: TestClient;
let instanceAdmin: TestClient;
let cookies: Record<'admin' | 'removed' | 'kept', string>;
const dataDir = mkdtempSync(join(tmpdir(), 'planar-pj11-'));
const file = Buffer.from('pj11 secret attachment');
const sha = createHash('sha256').update(file).digest('hex');

let taskId: string; // in the custom project
let openTaskId: string; // in an inheriting project
let openProjectId: string;
let commentId: string;

const ids = (rows: Record<string, unknown>[] | undefined) => (rows ?? []).map((r) => r.id);

beforeAll(async () => {
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN, dataDir });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  w = await world(db);
  const s = services(db);
  removed = new TestClient(s, await mkUser(db));
  kept = new TestClient(s, await mkUser(db));
  instanceAdmin = new TestClient(s, await mkUser(db, 'admin'));
  for (const c of [removed, kept])
    await w.admin.ok('member.add', {
      id: uuidv7(),
      spaceId: w.spaceId,
      userId: c.userId,
      role: 'member',
    });
  // an inheriting project with a task
  openProjectId = uuidv7();
  await w.admin.ok('project.create', {
    id: openProjectId,
    spaceId: w.spaceId,
    name: 'Open',
    key: key(),
    rank: 'a1',
  });
  const open = taskArgs(w, { projectId: openProjectId });
  openTaskId = open.id;
  await w.admin.ok('task.create', open);
  // the project under test: a task, a comment, a label, an attachment
  const t = taskArgs(w);
  taskId = t.id;
  await w.admin.ok('task.create', t);
  commentId = uuidv7();
  await w.admin.ok('comment.create', {
    id: commentId,
    taskId,
    body: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  await db.insert(schema.attachments).values({
    spaceId: w.spaceId,
    taskId,
    fileSha256: sha,
    name: 'secret.txt',
    mime: 'text/plain',
    size: file.length,
    uploadedBy: w.admin.userId,
  });
  cookies = {
    admin: await loginCookie(db, w.admin.userId),
    removed: await loginCookie(db, removed.userId),
    kept: await loginCookie(db, kept.userId),
  };
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

const mode = async () =>
  (await db.select().from(schema.projects).where(eq(schema.projects.id, w.projectId)))[0]!
    .membersMode;

const makeCustom = () =>
  w.admin.push('project.setMembersMode', {
    projectId: w.projectId,
    mode: 'custom',
    // the space admin is not in the list: he keeps access anyway
    members: [{ id: uuidv7(), userId: kept.userId, role: 'member' }],
  });

const rest = (
  url: string,
  who: keyof typeof cookies,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      headers: { cookie: cookies[who], origin: ORIGIN },
      payload: body as object,
    });

/** all rows of the project in a bootstrap: by project, task or comment reference */
function projectRows(data: Record<string, Record<string, unknown>[]>) {
  const out: string[] = [];
  for (const [e, rows] of Object.entries(data))
    for (const r of rows)
      if (
        r.projectId === w.projectId ||
        r.taskId === taskId ||
        r.commentId === commentId ||
        (e === 'projects' && r.id === w.projectId) ||
        (e === 'tasks' && r.id === taskId)
      )
        out.push(`${e}:${String(r.id)}`);
  return out;
}

describe('pj11: права на смену состава', () => {
  it('pj11 участник, гость и посторонний не меняют состав (forbidden / not_found), админ пространства и админ экземпляра — да', async () => {
    const args = (mode: string) => ({
      projectId: w.projectId,
      mode,
      members: [{ id: uuidv7(), userId: kept.userId, role: 'member' }],
    });
    expect(await w.member.push('project.setMembersMode', args('custom'))).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    expect(await w.guest.push('project.setMembersMode', args('custom'))).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    expect(await w.outsider.push('project.setMembersMode', args('custom'))).toMatchObject({
      ok: false,
    });
    expect(await mode()).toBe('inherit');
    // an instance admin who is not a member of the space
    expect(await instanceAdmin.push('project.setMembersMode', args('custom'))).toMatchObject({
      ok: true,
    });
    expect(await mode()).toBe('custom');
    expect(
      await instanceAdmin.push('project.setMembersMode', {
        projectId: w.projectId,
        mode: 'inherit',
      }),
    ).toMatchObject({ ok: true });
    expect(await mode()).toBe('inherit');
  });

  it('pj11 без перекрытия состав совпадает с пространством: все участники видят проект', async () => {
    for (const c of [w.admin, w.member, w.guest, removed, kept]) {
      const d = (await c.bootstrap()).data;
      expect(ids(d.projects), c.userId).toContain(w.projectId);
      expect(ids(d.tasks), c.userId).toContain(taskId);
      expect(d.projectMembers).toEqual([]);
    }
    expect(ids((await w.outsider.bootstrap()).data.projects)).not.toContain(w.projectId);
    expect(await projectAccess(db, w.guest.userId, w.projectId)).toBe('guest');
    expect(await projectAccess(db, w.member.userId, w.projectId)).toBe('member');
    expect(await projectAccess(db, w.outsider.userId, w.projectId)).toBeNull();
  });
});

describe('pj11: убранный участник — sync', () => {
  it('pj11 bootstrap: нет ни проекта, ни его задач, комментариев, статусов, вложений; чужие проекты на месте', async () => {
    const before = await removed.bootstrap();
    expect(projectRows(before.data).length).toBeGreaterThan(5);
    expect(await makeCustom()).toMatchObject({ ok: true });

    const gone = await removed.bootstrap();
    expect(projectRows(gone.data)).toEqual([]);
    expect(ids(gone.data.projects)).toContain(openProjectId);
    expect(ids(gone.data.tasks)).toContain(openTaskId);
    expect(gone.data.projectMembers).toEqual([]);

    // kept: sees all, including the composition; space admin: sees all without being listed
    const k = await kept.bootstrap();
    const noComposition = (d: Parameters<typeof projectRows>[0]) =>
      projectRows(d).filter((x) => !x.startsWith('projectMembers:'));
    expect(noComposition(k.data)).toEqual(projectRows(before.data));
    expect(k.data.projectMembers).toHaveLength(1);
    const a = await w.admin.bootstrap();
    expect(noComposition(a.data)).toEqual(projectRows(before.data));
    expect(a.data.projectMembers).toHaveLength(1);
    // a space member not in the list (member, guest) is hidden as well
    for (const c of [w.member, w.guest])
      expect(projectRows((await c.bootstrap()).data)).toEqual([]);
  });

  it('pj11 смена режима: убранному приходит reset; последующие изменения проекта в pull не попадают', async () => {
    const { cursor } = await removed.bootstrap();
    const t = taskArgs(w, { title: 'later' });
    await w.admin.ok('task.create', t);
    const label = uuidv7();
    await w.admin.ok('label.create', {
      id: label,
      projectId: w.projectId,
      name: 'L',
      color: '#fff',
    });
    await w.admin.ok('task.addLabel', { id: uuidv7(), taskId: t.id, labelId: label });
    await w.admin.ok('comment.create', {
      id: uuidv7(),
      taskId: t.id,
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    const open = taskArgs(w, { projectId: openProjectId, title: 'open later' });
    await w.admin.ok('task.create', open);

    const r = await removed.pull(cursor);
    expect(r.reset).toBeUndefined();
    const seen = r.changes.map((c) => `${c.entity}:${c.id}`);
    expect(seen).toContain(`tasks:${open.id}`);
    expect(seen).not.toContain(`tasks:${t.id}`);
    expect(seen).not.toContain(`labels:${label}`);
    for (const c of r.changes)
      expect(JSON.stringify(c.data ?? {}), `${c.entity}`).not.toContain(t.id);
    // the members get everything
    const m = await kept.pull(cursor);
    const mine = m.changes.map((c) => `${c.entity}:${c.id}`);
    expect(mine).toEqual(expect.arrayContaining([`tasks:${t.id}`, `labels:${label}`]));
    expect(mine.some((x) => x.startsWith('comments:'))).toBe(true);
    expect(mine.some((x) => x.startsWith('taskLabels:'))).toBe(true);
    // the space admin too
    expect((await w.admin.pull(cursor)).changes.map((c) => c.id)).toContain(t.id);
  });

  it('pj11 пользователь, убранный из состава (projectMember.remove), получает reset, добавленный — снова всё', async () => {
    const rowId = uuidv7();
    const c0 = (await removed.bootstrap()).cursor;
    await w.admin.ok('projectMember.add', {
      id: rowId,
      projectId: w.projectId,
      userId: removed.userId,
      role: 'member',
    });
    expect(await removed.pull(c0)).toMatchObject({ reset: true });
    const withIt = await removed.bootstrap();
    expect(ids(withIt.data.tasks)).toContain(taskId);

    await w.admin.ok('projectMember.remove', { id: rowId });
    expect(await removed.pull(withIt.cursor)).toMatchObject({ reset: true });
    expect(projectRows((await removed.bootstrap()).data)).toEqual([]);
  });

  it('pj11 inherit возвращает проект всем участникам пространства; режим custom без участников невозможен', async () => {
    expect(
      await w.admin.push('project.setMembersMode', { projectId: w.projectId, mode: 'custom' }),
    ).toMatchObject({ ok: false, code: 'invalid_args' });
    const { cursor } = await removed.bootstrap();
    await w.admin.ok('project.setMembersMode', { projectId: w.projectId, mode: 'inherit' });
    expect(await removed.pull(cursor)).toMatchObject({ reset: true });
    const d = (await removed.bootstrap()).data;
    expect(ids(d.tasks)).toContain(taskId);
    expect(d.projectMembers).toEqual([]);
    expect(await db.select().from(schema.projectMembers)).toEqual([]);
  });
});

describe('pj11: убранный участник — мутаторы и серверные места', () => {
  beforeAll(async () => {
    await w.admin.ok('project.setMembersMode', {
      projectId: w.projectId,
      mode: 'custom',
      members: [{ id: uuidv7(), userId: kept.userId, role: 'member' }],
    });
  });

  it('pj11 мутаторы: чужая строка скрытого проекта — not_found, не forbidden; участник работает', async () => {
    expect(await removed.push('task.update', { id: taskId, title: 'x' })).toMatchObject({
      ok: false,
      code: 'not_found',
    });
    expect(
      await removed.push('comment.create', {
        id: uuidv7(),
        taskId,
        body: { type: 'doc', content: [{ type: 'paragraph' }] },
      }),
    ).toMatchObject({ ok: false, code: 'not_found' });
    expect(await removed.push('task.create', taskArgs(w))).toMatchObject({
      ok: false,
      code: 'not_found',
    });
    expect(
      await removed.push('task.assign', { id: uuidv7(), taskId, userId: removed.userId }),
    ).toMatchObject({ ok: false, code: 'not_found' });
    expect(await removed.push('task.update', { id: openTaskId, title: 'ok' })).toMatchObject({
      ok: true,
    });
    expect(await kept.push('task.update', { id: taskId, title: 'by member' })).toMatchObject({
      ok: true,
    });
    // a role in the project lowers the rights: a guest in the project cannot write
    const row = (
      await db
        .select()
        .from(schema.projectMembers)
        .where(eq(schema.projectMembers.userId, kept.userId))
    )[0]!;
    await w.admin.ok('projectMember.setRole', { id: row.id, role: 'guest' });
    expect(await kept.push('task.update', { id: taskId, title: 'as guest' })).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    await w.admin.ok('projectMember.setRole', { id: row.id, role: 'member' });
  });

  it('pj11 REST по id: 404, списки и поиск без скрытого проекта; участник и админ видят', async () => {
    for (const url of [
      `/api/v1/tasks/${taskId}`,
      `/api/v1/tasks/${taskId}/comments`,
      `/api/v1/tasks/${taskId}/links`,
      `/api/v1/projects/${w.projectId}/fields`,
      `/api/v1/projects/${w.projectId}/cycles`,
      `/api/tasks/${taskId}/activity`,
    ])
      expect((await rest(url, 'removed')).statusCode, url).toBe(404);
    expect((await rest(`/api/v1/tasks/${taskId}`, 'kept')).statusCode).toBe(200);
    expect((await rest(`/api/v1/tasks/${taskId}`, 'admin')).statusCode).toBe(200);
    expect((await rest(`/api/tasks/${taskId}/activity`, 'kept')).statusCode).toBe(200);

    const list = async (url: string, who: keyof typeof cookies) =>
      ((await rest(url, who)).json().data as { id: string }[]).map((r) => r.id);
    expect(await list('/api/v1/tasks?limit=200', 'removed')).not.toContain(taskId);
    expect(await list('/api/v1/tasks?limit=200', 'removed')).toContain(openTaskId);
    expect(await list('/api/v1/tasks?limit=200', 'kept')).toContain(taskId);
    expect(await list('/api/v1/projects?limit=200', 'removed')).not.toContain(w.projectId);
    expect(await list('/api/v1/projects?limit=200', 'removed')).toContain(openProjectId);
    expect(await list('/api/v1/projects?limit=200', 'admin')).toContain(w.projectId);

    const create = await rest('/api/v1/tasks', 'removed', 'POST', {
      projectId: w.projectId,
      title: 'sneak',
    });
    expect(create.statusCode).toBe(404);
  });

  it('pj11 поиск (MCP search_tasks / my_tasks): скрытая задача не находится', async () => {
    const svc = new RestService(db);
    const title = (await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)))[0]!
      .title;
    const hit = async (userId: string) =>
      (await svc.searchTasks(userId, { query: title })).map((t) => t.id);
    expect(await hit(removed.userId)).not.toContain(taskId);
    expect(await hit(kept.userId)).toContain(taskId);
    await w.admin.ok('task.assign', { id: uuidv7(), taskId, userId: w.admin.userId });
    expect(
      (await svc.searchTasks(w.admin.userId, { assigneeId: 'me' })).map((t) => t.id),
    ).toContain(taskId);
  });

  it('pj11 файлы: вложение скрытого проекта — 404 убранному, 200 участнику и админу', async () => {
    const up = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/files',
        headers: {
          cookie: cookies.admin,
          origin: ORIGIN,
          'content-type': 'multipart/form-data; boundary=pj11',
        },
        payload: Buffer.concat([
          Buffer.from(
            '--pj11\r\nContent-Disposition: form-data; name="file"; filename="s.txt"\r\nContent-Type: text/plain\r\n\r\n',
          ),
          file,
          Buffer.from('\r\n--pj11--\r\n'),
        ]),
      });
    expect(up.statusCode, up.body).toBe(201);
    const get = (who: keyof typeof cookies) =>
      app
        .getHttpAdapter()
        .getInstance()
        .inject({ method: 'GET', url: `/files/${sha}`, headers: { cookie: cookies[who] } });
    expect((await get('removed')).statusCode).toBe(404);
    expect((await get('kept')).statusCode).toBe(200);
    expect((await get('admin')).statusCode).toBe(200);
  });

  it('pj11 уведомления: исполнитель/упоминание из скрытого проекта не создают уведомление и подписку', async () => {
    const t = taskArgs(w, { title: 'secret assign' });
    await w.admin.ok('task.create', t);
    // the assignment itself is a mutation by an admin on behalf of the project; the removed user is not notified
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: removed.userId });
    await w.admin.ok('comment.create', {
      id: uuidv7(),
      taskId: t.id,
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    expect(
      await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, removed.userId)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.taskWatchers)
        .where(eq(schema.taskWatchers.userId, removed.userId)),
    ).toEqual([]);
    // the member of the project is notified
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: kept.userId });
    expect(
      (
        await db
          .select()
          .from(schema.notifications)
          .where(eq(schema.notifications.userId, kept.userId))
      ).length,
    ).toBeGreaterThan(0);
  });

  it('pj11 модули: канал чата и страница документа скрытого проекта — не в sync, 404 в маршрутах чата', async () => {
    await instanceAdmin.ok('settings.set', { id: 'enabled_modules', value: ['chat'] });
    const now = new Date().toISOString();
    const channel = uuidv7();
    const page = uuidv7();
    await db.insert(chatChannels).values({
      id: channel,
      spaceId: w.spaceId,
      projectId: w.projectId,
      kind: 'channel',
      name: 'secret',
      createdBy: w.admin.userId,
      lastSeq: 0,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(docsPages).values({
      id: page,
      spaceId: w.spaceId,
      projectId: w.projectId,
      rank: 'a0',
      title: 'secret page',
      body: { type: 'doc', content: [] },
      text: '',
      files: [],
      createdBy: w.admin.userId,
      updatedBy: w.admin.userId,
      createdAt: now,
      updatedAt: now,
    });
    const gone = (await removed.bootstrap()).data;
    expect(ids(gone.chatChannels)).not.toContain(channel);
    expect(ids(gone.docsPages)).not.toContain(page);
    const mine = (await kept.bootstrap()).data;
    expect(ids(mine.chatChannels)).toContain(channel);
    expect(ids(mine.docsPages)).toContain(page);
    expect((await rest(`/api/chat/channels/${channel}/messages`, 'removed')).statusCode).toBe(404);
    expect((await rest(`/api/chat/channels/${channel}/messages`, 'kept')).statusCode).toBe(200);
  });

  it('pj11 viewersOf (typing): убранный не получает', async () => {
    const v = await viewersOf(db, 'tasks', taskId);
    expect(v?.has(removed.userId)).toBe(false);
    expect(v?.has(kept.userId)).toBe(true);
    expect(v?.has(w.admin.userId)).toBe(true);
    expect((await viewersOf(db, 'tasks', openTaskId))?.has(removed.userId)).toBe(true);
  });

  it('pj11 смена роли в пространстве и роли экземпляра пишет _reset; роль проекта — из projectMembers', async () => {
    const x = new TestClient(services(db), await mkUser(db, 'admin'));
    const sm = uuidv7();
    await w.admin.ok('member.add', { id: sm, spaceId: w.spaceId, userId: x.userId, role: 'admin' });
    // a space admin outside the composition sees the hidden project; demoted -> reset and no project
    const c0 = (await x.bootstrap()).cursor;
    expect(ids((await x.bootstrap()).data.projects)).toContain(w.projectId);
    await w.admin.ok('member.update', { id: sm, role: 'member' });
    // still an instance admin -> keeps access; drop that too through the system tx
    expect(await x.pull(c0)).toMatchObject({ reset: true });
    const c1 = (await x.bootstrap()).cursor;
    await db.transaction((q) => updateUser(q, w.admin.userId, x.userId, { role: 'member' }));
    expect(await x.pull(c1)).toMatchObject({ reset: true });
    expect(ids((await x.bootstrap()).data.projects)).not.toContain(w.projectId);
    // a project admin who is a space member does admin-level writes in the project (the SQL rule)
    await w.admin.ok('projectMember.add', {
      id: uuidv7(),
      projectId: w.projectId,
      userId: x.userId,
      role: 'admin',
    });
    expect(
      await x.push('status.create', {
        id: uuidv7(),
        projectId: w.projectId,
        name: 'Extra',
        category: 'todo',
        color: '#fff',
        rank: 'a9',
      }),
    ).toMatchObject({ ok: true });
  });

  it('pj11 удаление участника из пространства убирает его строки projectMembers', async () => {
    const x = new TestClient(services(db), await mkUser(db));
    const sm = uuidv7();
    await w.admin.ok('member.add', {
      id: sm,
      spaceId: w.spaceId,
      userId: x.userId,
      role: 'member',
    });
    await w.admin.ok('projectMember.add', {
      id: uuidv7(),
      projectId: w.projectId,
      userId: x.userId,
      role: 'member',
    });
    await w.admin.ok('member.remove', { id: sm });
    expect(
      await db
        .select()
        .from(schema.projectMembers)
        .where(eq(schema.projectMembers.userId, x.userId)),
    ).toEqual([]);
  });
});
