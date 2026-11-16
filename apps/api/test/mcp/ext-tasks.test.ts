import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTokenCreatedSchema } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { area } from '../../src/rest/ext/tasks.js';
import { RestService } from '../../src/rest/rest.service.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, world, type World } from '../sync/helpers.js';

// MA-3 (PLNRAPP-273 without attachments): task operations over REST v1 and MCP, as the user
const PARITY_TASKS: Record<string, string> = {
  'DELETE /api/v1/tasks/{task}': 'delete_task',
  'POST /api/v1/tasks/{task}/archive': 'archive_task',
  'POST /api/v1/tasks/{task}/restore': 'restore_task',
  'POST /api/v1/tasks/merge': 'merge_tasks',
  'POST /api/v1/tasks/{task}/watch': 'watch_task',
  'POST /api/v1/tasks/{task}/unwatch': 'unwatch_task',
  'GET /api/v1/tasks/{task}/checklist': 'list_checklist',
  'POST /api/v1/tasks/{task}/checklist': 'add_checklist_item',
  'PATCH /api/v1/checklist/{id}': 'update_checklist_item',
  'DELETE /api/v1/checklist/{id}': 'delete_checklist_item',
  'POST /api/v1/comments/{id}/reactions': 'toggle_reaction',
  'DELETE /api/v1/comments/{id}': 'delete_comment',
  'GET /api/v1/tasks/{task}/activity': 'task_activity',
};

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
let admin: string;
let member: string;
let read: string;
let outsider: string;

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

beforeAll(async () => {
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.listen(0, '127.0.0.1');
  w = await world(db);
  admin = await issue(w.admin.userId, 'write');
  member = await issue(w.member.userId, 'write');
  read = await issue(w.admin.userId, 'read');
  outsider = await issue(w.outsider.userId, 'write');
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

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
const mk = async (title: string) =>
  (await rest(admin, 'POST', '/tasks', { projectId: w.projectId, title }))[1].data as {
    id: string;
    key: string;
  };

describe('задачи: операции REST v1', () => {
  it('PARITY_TASKS равен операциям области; удаления — danger', () => {
    expect(
      Object.fromEntries(area.ops.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o.tool])),
    ).toEqual(PARITY_TASKS);
    const defs = toolDefs(app.get(RestService));
    for (const o of area.ops) {
      const d = defs.find((x) => x.name === o.tool);
      expect(d?.write, o.tool).toBe(o.write);
      expect(d?.danger, o.tool).toBe(
        o.method === 'delete' ? 'delete' : o.tool === 'merge_tasks' ? 'bulk' : undefined,
      );
    }
  });

  it('архив, возврат, подписка, лента; ключ задачи; чужой и read-токен отказ', async () => {
    const t = await mk('A');
    expect((await rest(admin, 'POST', `/tasks/${t.key}/archive`))[0]).toBe(200);
    expect((await rest(admin, 'GET', `/tasks/${t.id}`))[1].data.archivedAt).toBeTruthy();
    expect((await rest(admin, 'POST', `/tasks/${t.id}/restore`))[0]).toBe(200);
    expect((await rest(admin, 'GET', `/tasks/${t.id}`))[1].data.archivedAt).toBeFalsy();
    expect((await rest(member, 'POST', `/tasks/${t.id}/watch`))[0]).toBe(200);
    expect((await rest(member, 'POST', `/tasks/${t.id}/unwatch`))[0]).toBe(200);
    const [s, act] = await rest(admin, 'GET', `/tasks/${t.id}/activity?limit=5`);
    expect(s).toBe(200);
    expect(act.data.map((a: { kind: string }) => a.kind)).toContain('created');
    for (const [m, u] of [
      ['POST', `/tasks/${t.id}/archive`],
      ['POST', `/tasks/${t.id}/watch`],
      ['GET', `/tasks/${t.id}/activity`],
      ['GET', `/tasks/${t.id}/checklist`],
    ] as const)
      expect((await rest(outsider, m, u))[0], u).toBe(404);
    expect((await rest(read, 'POST', `/tasks/${t.id}/archive`))[0]).toBe(403);
  });

  it('чек-лист: добавить, изменить, удалить', async () => {
    const t = await mk('C');
    const [s, a] = await rest(admin, 'POST', `/tasks/${t.id}/checklist`, { text: 'один' });
    const [, b] = await rest(admin, 'POST', `/tasks/${t.id}/checklist`, { text: 'два' });
    expect(s).toBe(201);
    expect(b.data.rank > a.data.rank).toBe(true);
    const [, u] = await rest(admin, 'PATCH', `/checklist/${a.data.id}`, { done: true, text: 'х' });
    expect([u.data.done, u.data.text]).toEqual([true, 'х']);
    expect((await rest(outsider, 'PATCH', `/checklist/${a.data.id}`, { done: false }))[0]).toBe(
      404,
    );
    expect((await rest(read, 'DELETE', `/checklist/${a.data.id}`))[0]).toBe(403);
    expect((await rest(admin, 'DELETE', `/checklist/${a.data.id}`))[0]).toBe(204);
    expect((await rest(admin, 'GET', `/tasks/${t.id}/checklist`))[1].data).toHaveLength(1);
  });

  it('комментарий: реакция туда-обратно, удаление автором', async () => {
    const t = await mk('R');
    const [, c] = await rest(admin, 'POST', `/tasks/${t.id}/comments`, { text: 'привет' });
    const cid = c.data.id as string;
    expect((await rest(member, 'POST', `/comments/${cid}/reactions`, { emoji: '👍' }))[0]).toBe(
      200,
    );
    expect((await rest(outsider, 'POST', `/comments/${cid}/reactions`, { emoji: '👍' }))[0]).toBe(
      404,
    );
    expect((await rest(read, 'DELETE', `/comments/${cid}`))[0]).toBe(403);
    expect((await rest(member, 'DELETE', `/comments/${cid}`))[0]).toBe(403);
    expect((await rest(admin, 'DELETE', `/comments/${cid}`))[0]).toBe(204);
    expect((await rest(admin, 'GET', `/tasks/${t.id}/comments`))[1].data).toHaveLength(0);
  });

  it('слияние и удаление; удаление не для member', async () => {
    const a = await mk('M1');
    const b = await mk('M2');
    const t = await mk('M3');
    expect(
      (await rest(outsider, 'POST', '/tasks/merge', { taskIds: [a.id], target: t.id }))[0],
    ).toBe(404);
    expect((await rest(read, 'POST', '/tasks/merge', { taskIds: [a.id], target: t.id }))[0]).toBe(
      403,
    );
    const [s] = await rest(admin, 'POST', '/tasks/merge', { taskIds: [a.key, b.id], target: t.id });
    expect(s).toBe(200);
    expect((await rest(admin, 'GET', `/tasks/${a.id}`))[1].data.statusId).not.toBe(w.statusIds[0]);
    expect((await rest(member, 'DELETE', `/tasks/${t.id}`))[0]).toBe(403);
    expect((await rest(outsider, 'DELETE', `/tasks/${t.id}`))[0]).toBe(404);
    expect((await rest(read, 'DELETE', `/tasks/${t.id}`))[0]).toBe(403);
    expect((await rest(admin, 'DELETE', `/tasks/${t.id}`))[0]).toBe(204);
    expect((await rest(admin, 'GET', `/tasks/${t.id}`))[0]).toBe(404);
  });
});
