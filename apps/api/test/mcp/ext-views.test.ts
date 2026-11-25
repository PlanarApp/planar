import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTokenCreatedSchema, uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { area } from '../../src/rest/ext/views.js';
import { RestService } from '../../src/rest/rest.service.js';
import * as schema from '../../src/db/schema.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, world, type World } from '../sync/helpers.js';

// PLNRAPP-274: views, favourites, "My day", notifications over REST v1 and MCP
export const PARITY_VIEWS: Record<string, string> = {
  'GET /api/v1/views': 'list_views',
  'POST /api/v1/views': 'create_view',
  'PATCH /api/v1/views/{id}': 'update_view',
  'DELETE /api/v1/views/{id}': 'delete_view',
  'POST /api/v1/views/default': 'set_view_default',
  'GET /api/v1/favorites': 'list_favorites',
  'POST /api/v1/favorites': 'add_favorite',
  'PATCH /api/v1/favorites/{id}': 'move_favorite',
  'DELETE /api/v1/favorites/{id}': 'remove_favorite',
  'GET /api/v1/my-day': 'list_my_day',
  'GET /api/v1/notifications': 'list_notifications',
  'POST /api/v1/notifications/read': 'mark_notifications_read',
  'POST /api/v1/notifications/read-all': 'mark_all_notifications_read',
  'DELETE /api/v1/notifications/{id}': 'delete_notification',
};

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
let w: World;
let admin: string;
let member: string;
let read: string;
let outsider: string;
let taskId: string;

async function issue(userId: string, scope: 'read' | 'write') {
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie: await loginCookie(db, userId), origin: ORIGIN },
      payload: { name: 't', scope },
    });
  return apiTokenCreatedSchema.parse(r.json()).secret;
}

const rest = async (secret: string, method: string, url: string, payload?: object) => {
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
  return [r.statusCode, r.body ? r.json() : null] as const;
};

beforeAll(async () => {
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  w = await world(db);
  admin = await issue(w.admin.userId, 'write');
  member = await issue(w.member.userId, 'write');
  read = await issue(w.admin.userId, 'read');
  outsider = await issue(w.outsider.userId, 'write');
  const [, t] = await rest(admin, 'POST', '/tasks', { projectId: w.projectId, title: 'T' });
  taskId = t.data.id;
});
afterAll(async () => {
  kids.forEach((k) => k.kill());
  await app.close();
  await db.$client.end();
});

const kids: ReturnType<typeof spawn>[] = [];
async function mcp(secret: string) {
  const p = spawn(
    process.execPath,
    [new URL('./bridge.mjs', import.meta.url).pathname, `${base}/mcp`, secret],
    { cwd: new URL('../..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  kids.push(p);
  const lines = createInterface({ input: p.stdout! })[Symbol.asyncIterator]();
  const next = async () => JSON.parse((await lines.next()).value as string);
  await next();
  let id = 0;
  return async (name: string, args: Record<string, unknown> = {}) => {
    p.stdin!.write(
      JSON.stringify({ id: ++id, method: 'callTool', params: { name, arguments: args } }) + '\n',
    );
    const r = await next();
    if (r.error) throw new Error(r.error);
    const res = r.result as { isError?: boolean; content: { text: string }[] };
    return [!!res.isError, JSON.parse(res.content[0]!.text)] as const;
  };
}

describe('виды, избранное, Мой день, уведомления', () => {
  it('PARITY_VIEWS равен операциям области; удаления — danger', () => {
    expect(
      Object.fromEntries(area.ops.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o.tool])),
    ).toEqual(PARITY_VIEWS);
    const defs = toolDefs(app.get(RestService));
    for (const o of area.ops.filter((o) => o.method === 'delete'))
      expect(defs.find((d) => d.name === o.tool)?.danger, o.tool).toBe('delete');
    expect(defs.find((d) => d.name === 'list_views')?.write).toBe(false);
  });

  it('виды: создать, изменить, список, вид по умолчанию, удалить; чужой — 404', async () => {
    const [s0, v] = await rest(admin, 'POST', '/views', {
      spaceId: w.spaceId,
      name: 'Мой',
      layout: 'list',
    });
    expect([s0, v.data.name, v.data.userId]).toEqual([201, 'Мой', w.admin.userId]);
    expect(
      (await rest(admin, 'PATCH', `/views/${v.data.id}`, { name: 'Мой 2' }))[1].data.name,
    ).toBe('Мой 2');
    // personal view is private: the member sees neither the row nor can touch it
    const ids = (r: readonly [number, { data: { id: string }[] }]) => r[1].data.map((x) => x.id);
    expect(ids(await rest(admin, 'GET', `/views?spaceId=${w.spaceId}`))).toContain(v.data.id);
    expect(ids(await rest(member, 'GET', '/views'))).not.toContain(v.data.id);
    expect((await rest(member, 'PATCH', `/views/${v.data.id}`, { name: 'x' }))[0]).toBe(404);
    expect((await rest(outsider, 'GET', `/views?spaceId=${w.spaceId}`))[0]).toBe(404);
    expect(
      (
        await rest(outsider, 'POST', '/views', { spaceId: w.spaceId, name: 'x', layout: 'list' })
      )[0],
    ).toBe(404);
    expect((await rest(read, 'PATCH', `/views/${v.data.id}`, { name: 'x' }))[0]).toBe(403);

    const node = `p:${w.projectId}`;
    const [s1, d] = await rest(admin, 'POST', '/views/default', {
      spaceId: w.spaceId,
      node,
      layout: 'board',
    });
    expect([s1, d.data.node, d.data.userId]).toEqual([201, node, null]);
    expect((await rest(member, 'GET', `/views?node=${node}`))[1].data).toHaveLength(1);
    expect(
      (
        await rest(outsider, 'POST', '/views/default', {
          spaceId: w.spaceId,
          node,
          layout: 'board',
        })
      )[0],
    ).toBe(404);
    expect(
      (
        await rest(admin, 'POST', '/views/default', {
          spaceId: w.spaceId,
          node: `p:${uuidv7()}`,
          layout: 'board',
        })
      )[0],
    ).toBe(404);

    expect((await rest(read, 'DELETE', `/views/${v.data.id}`))[0]).toBe(403);
    expect((await rest(outsider, 'DELETE', `/views/${v.data.id}`))[0]).toBe(404);
    expect(await rest(admin, 'DELETE', `/views/${v.data.id}`)).toEqual([204, null]);
    expect((await rest(admin, 'DELETE', `/views/${v.data.id}`))[0]).toBe(404);
  });

  it('избранное: добавить (повтор — та же запись), переставить, только своё', async () => {
    const body = { kind: 'project', refId: w.projectId, name: 'P', url: `/p/${w.projectId}` };
    const [s0, f] = await rest(admin, 'POST', '/favorites', body);
    expect([s0, f.data.refId]).toEqual([201, w.projectId]);
    expect((await rest(admin, 'POST', '/favorites', body))[1].data.id).toBe(f.data.id);
    expect((await rest(admin, 'GET', '/favorites'))[1].data).toHaveLength(1);
    expect((await rest(member, 'GET', '/favorites'))[1].data).toEqual([]);
    expect((await rest(outsider, 'POST', '/favorites', body))[0]).toBe(404);
    expect((await rest(read, 'POST', '/favorites', body))[0]).toBe(403);
    expect(
      (await rest(admin, 'PATCH', `/favorites/${f.data.id}`, { rank: 'zz' }))[1].data.rank,
    ).toBe('zz');
    expect((await rest(member, 'PATCH', `/favorites/${f.data.id}`, { rank: 'a' }))[0]).toBe(404);
    expect((await rest(member, 'DELETE', `/favorites/${f.data.id}`))[0]).toBe(404);
    expect((await rest(read, 'DELETE', `/favorites/${f.data.id}`))[0]).toBe(403);
    expect((await rest(admin, 'DELETE', `/favorites/${f.data.id}`))[0]).toBe(204);
    expect((await rest(admin, 'GET', '/favorites'))[1].data).toEqual([]);
  });

  it('избранное: видимость каждого вида ссылки, чужое и несуществующее — 404', async () => {
    const pageId = uuidv7();
    const chatId = uuidv7();
    const dmId = uuidv7();
    const now = new Date().toISOString();
    await db.execute(sql`insert into docs_pages (id, space_id, rank, title, body, text, files, created_by, updated_by, created_at, updated_at)
      values (${pageId}, ${w.spaceId}, 'a0', 'D', '{}'::jsonb, '', '[]'::jsonb, ${w.admin.userId}, ${w.admin.userId}, ${now}, ${now})`);
    await db.execute(sql`insert into chat_channels (id, space_id, kind, name, created_by, last_seq, created_at, updated_at)
      values (${chatId}, ${w.spaceId}, 'channel', 'C', ${w.admin.userId}, 0, ${now}, ${now}),
             (${dmId}, null, 'dm', null, ${w.admin.userId}, 0, ${now}, ${now})`);
    await db.execute(sql`insert into chat_members (id, channel_id, user_id, added_by, created_at)
      values (${uuidv7()}, ${dmId}, ${w.admin.userId}, ${w.admin.userId}, ${now})`);
    const add = (tok: string, kind: string, refId: string) =>
      rest(tok, 'POST', '/favorites', { kind, refId, name: 'N', url: '/x' }).then((r) => r[0]);
    for (const [kind, refId] of [
      ['workspace', 'w'],
      ['space', w.spaceId],
      ['task', taskId],
      ['doc', pageId],
      ['chat', chatId],
      ['chat', dmId],
    ] as const)
      expect(await add(admin, kind, refId), kind).toBe(201);
    // outsider (no spaces) and member (not in the dialog) see none of the foreign ones
    for (const [kind, refId] of [
      ['space', w.spaceId],
      ['task', taskId],
      ['doc', pageId],
      ['chat', chatId],
      ['chat', dmId],
    ] as const)
      expect(await add(outsider, kind, refId), kind).toBe(404);
    expect(await add(member, 'chat', dmId)).toBe(404);
    expect(await add(admin, 'task', uuidv7())).toBe(404);
    expect(await add(admin, 'doc', 'not-a-uuid')).toBe(404);
    expect(await add(admin, 'workspace', 'x')).toBe(404);
  });

  // PLNRAPP-700: favourites of a deleted task (and its subtasks) are removed for every user, with sync changes
  it('избранное: удаление задачи убирает её из избранного у всех пользователей', async () => {
    const [, p] = await rest(admin, 'POST', '/tasks', { projectId: w.projectId, title: 'P' });
    const [, c] = await rest(admin, 'POST', '/tasks', {
      projectId: w.projectId,
      title: 'C',
      parentId: p.data.id,
    });
    const fav = (tok: string, id: string) =>
      rest(tok, 'POST', '/favorites', { kind: 'task', refId: id, name: 'T', url: '/t/x' });
    const ids = (tok: string) =>
      rest(tok, 'GET', '/favorites').then((r) =>
        (r[1].data as { refId: string }[]).map((f) => f.refId),
      );
    expect((await fav(admin, p.data.id))[0]).toBe(201);
    expect((await fav(admin, c.data.id))[0]).toBe(201);
    const [s, mf] = await fav(member, p.data.id);
    expect(s).toBe(201);
    expect((await rest(admin, 'DELETE', `/tasks/${p.data.id}`))[0]).toBe(204);
    for (const tok of [admin, member]) {
      expect(await ids(tok)).not.toContain(p.data.id);
      expect(await ids(tok)).not.toContain(c.data.id);
    }
    // the member's sidebar updates without F5: the deletion is in the sync log for them
    const { rows } = await db.$client.query(
      `select user_id from changes where entity = 'favorites' and id = $1 and op = 'del'`,
      [mf.data.id],
    );
    expect(rows).toEqual([{ user_id: w.member.userId }]);
  });

  // PLNRAPP-709, PLNRAPP-711: «My day» — my tasks (assignee) by dueDate; read only
  it('Мой день по dueDate: только чтение, задачи, где я исполнитель', async () => {
    const [, t] = await rest(admin, 'POST', '/tasks', {
      projectId: w.projectId,
      title: 'D',
      priority: 2,
      dueDate: '2030-01-04',
      assigneeIds: [w.admin.userId],
    });
    const tid = t.data.id as string;
    const ids = async (q: string) =>
      (await rest(admin, 'GET', `/my-day${q}`))[1].data.map((x: { id: string }) => x.id);
    expect(await ids('?dueDate=2030-01-04')).toContain(tid);
    expect(await ids('?dueDate=2030-01-03')).not.toContain(tid);
    // not an assignee: the task is not in the member's day
    expect((await rest(member, 'GET', '/my-day'))[1].data).toEqual([]);
    // read only: no write operations
    expect((await rest(admin, 'POST', '/my-day', { taskId: tid, date: '2030-01-02' }))[0]).toBe(
      404,
    );
    expect((await rest(admin, 'PATCH', `/my-day/${tid}`, { date: '2030-01-02' }))[0]).toBe(404);
    expect((await rest(admin, 'DELETE', `/my-day/${tid}`))[0]).toBe(404);
    const [, got] = await rest(admin, 'GET', `/tasks/${tid}`);
    expect(got.data.dueDate).toBe('2030-01-04');
    // sorting: by dueDate, then priority (0 «none» last), then key
    const [, u] = await rest(admin, 'POST', '/tasks', {
      projectId: w.projectId,
      title: 'E',
      priority: 1,
      dueDate: '2030-01-04',
      assigneeIds: [w.admin.userId],
    });
    const [, v] = await rest(admin, 'POST', '/tasks', {
      projectId: w.projectId,
      title: 'F',
      dueDate: '2030-01-01',
      assigneeIds: [w.admin.userId],
    });
    const day = await ids('');
    expect(day.filter((x: string) => [tid, u.data.id, v.data.id].includes(x))).toEqual([
      v.data.id,
      u.data.id,
      tid,
    ]);
  });

  it('уведомления: список, прочитано, всё прочитано, удалить; чужие недоступны', async () => {
    const mk = (userId: string) => ({
      id: uuidv7(),
      userId,
      spaceId: w.spaceId,
      kind: 'assigned',
      taskId,
      actorId: w.member.userId,
    });
    const mine = [mk(w.admin.userId), mk(w.admin.userId), mk(w.admin.userId)];
    const foreign = mk(w.member.userId);
    await db.insert(schema.notifications).values([...mine, foreign]);

    const list = async (q = '') =>
      (await rest(admin, 'GET', `/notifications${q}`))[1].data as {
        id: string;
        readAt: string | null;
      }[];
    expect((await list()).map((n) => n.id).sort()).toEqual(mine.map((n) => n.id).sort());
    expect(
      (await rest(member, 'GET', '/notifications'))[1].data.map((n: { id: string }) => n.id),
    ).toEqual([foreign.id]);

    expect((await rest(admin, 'POST', '/notifications/read', { ids: [foreign.id] }))[0]).toBe(404);
    expect((await rest(read, 'POST', '/notifications/read', { ids: [mine[0]!.id] }))[0]).toBe(403);
    expect(
      (await rest(admin, 'POST', '/notifications/read', { ids: [mine[0]!.id] }))[1].data,
    ).toEqual({ read: 1 });
    expect(await list('?unread=true')).toHaveLength(2);
    // PLNRAPP-861: z.stringbool() over MCP — "true" is not parsed a second time
    const [eu, unread] = await (await mcp(admin))('list_notifications', { unread: 'true' });
    expect(eu, JSON.stringify(unread)).toBe(false);
    expect(unread).toHaveLength(2);
    expect((await rest(read, 'POST', '/notifications/read-all', {}))[0]).toBe(403);
    expect((await rest(admin, 'POST', '/notifications/read-all', {}))[0]).toBe(200);
    expect(await list('?unread=true')).toHaveLength(0);
    // the foreign one stays unread
    expect((await rest(member, 'GET', '/notifications?unread=true&limit=5'))[1].data).toHaveLength(
      1,
    );

    expect((await rest(admin, 'DELETE', `/notifications/${foreign.id}`))[0]).toBe(404);
    expect((await rest(read, 'DELETE', `/notifications/${mine[1]!.id}`))[0]).toBe(403);
    expect((await rest(admin, 'DELETE', `/notifications/${mine[1]!.id}`))[0]).toBe(204);
    expect(await list()).toHaveLength(2);
  });

  it('MCP: те же операции; read-токен не пишет', async () => {
    const call = await mcp(admin);
    const [e, v] = await call('create_view', { spaceId: w.spaceId, name: 'M', layout: 'list' });
    expect(e, JSON.stringify(v)).toBe(false);
    expect(
      (await call('list_views', { spaceId: w.spaceId }))[1].map((x: { id: string }) => x.id),
    ).toContain(v.id);
    expect((await call('delete_view', { id: v.id }))[0]).toBe(false);
    const [er, fr] = await (
      await mcp(read)
    )('create_view', { spaceId: w.spaceId, name: 'M', layout: 'list' });
    expect([er, fr.code]).toEqual([true, 'forbidden']);
  });
});
