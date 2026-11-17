import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { apiTokenCreatedSchema, domainMutators, uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import * as schema from '../../src/db/schema.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { area } from '../../src/rest/ext/tasks.js';
import { dropRanks } from '../../src/rest/ext/tasks.service.js';
import { RestService } from '../../src/rest/rest.service.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, key, newDb, world, type World } from '../sync/helpers.js';

// MA-3 (PLNRAPP-273 without attachments): task operations over REST v1 and MCP, as the user
const PARITY_TASKS: Record<string, string> = {
  'DELETE /api/v1/tasks/{task}': 'delete_task',
  'POST /api/v1/tasks/{task}/archive': 'archive_task',
  'POST /api/v1/tasks/{task}/restore': 'restore_task',
  'POST /api/v1/tasks/merge': 'merge_tasks',
  'POST /api/v1/tasks/move': 'move_tasks',
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
        o.method === 'delete'
          ? 'delete'
          : ['merge_tasks', 'move_tasks'].includes(o.tool)
            ? 'bulk'
            : undefined,
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

describe('dropRanks', () => {
  it('задачи подряд между соседями; повторы рангов сдвигаются после вставки', () => {
    const col = [
      { id: 'a', rank: 'a1' },
      { id: 'b', rank: 'a3' },
    ];
    const r = dropRanks(col, 1, 3);
    expect(r.rerank).toEqual([]);
    expect(r.ranks).toHaveLength(3);
    expect(['a1', ...r.ranks, 'a3']).toEqual(['a1', ...r.ranks, 'a3'].slice().sort());
    expect(new Set(r.ranks).size).toBe(3);
    const dup = dropRanks(
      [
        { id: 'a', rank: 'a1' },
        { id: 'b', rank: 'a1' },
        { id: 'c', rank: 'a2' },
      ],
      1,
      2,
    );
    expect(dup.rerank.map(([id]) => id)).toEqual(['b']);
    const order = ['a1', ...dup.ranks, dup.rerank[0]![1], 'a2'];
    expect(order).toEqual(order.slice().sort());
    expect(dropRanks([], 0, 2).ranks).toHaveLength(2);
  });
});

describe('групповой перенос задач (PLNRAPP-292)', () => {
  type T = { id: string; key: string; statusId: string; rank: string };
  const get = async (id: string) => (await rest(admin, 'GET', `/tasks/${id}`))[1].data as T;
  /** ids of a status column, by rank */
  const column = async (statusId: string) =>
    (await db.select().from(schema.tasks).where(eq(schema.tasks.statusId, statusId)))
      .filter((t) => !t.archivedAt)
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
      .map((t) => t.id);
  const move = (secret: string, body: object) => rest(secret, 'POST', '/tasks/move', body);

  it('между статусами: подряд перед соседом в порядке taskIds; ответ — задачи', async () => {
    const st = w.statusIds[2]!;
    const [x, y] = [await mk('X'), await mk('Y')];
    await move(admin, { taskIds: [x.id, y.id], statusId: st });
    const [a, b, c] = [await mk('A'), await mk('B'), await mk('C')];
    const [s, r] = await move(admin, { taskIds: [c.key, a.id], statusId: st, before: y.id });
    expect(s).toBe(200);
    expect(r.data.map((t: T) => [t.id, t.statusId])).toEqual([
      [c.id, st],
      [a.id, st],
    ]);
    expect(await column(st)).toEqual([x.id, c.id, a.id, y.id]);
    expect((await get(b.id)).statusId).not.toBe(st);
    // index: position among the rest of the column
    await move(admin, { taskIds: [b.id], statusId: st, index: 0 });
    expect((await column(st))[0]).toBe(b.id);
  });

  it('внутри статуса: порядок сохраняется, якорь из переносимых', async () => {
    const st = w.statusIds[3]!;
    const t = [await mk('1'), await mk('2'), await mk('3'), await mk('4')];
    await move(admin, { taskIds: t.map((x) => x.id), statusId: st });
    expect(await column(st)).toEqual(t.map((x) => x.id));
    // 4 и 1 — в начало, в этом порядке
    expect((await move(admin, { taskIds: [t[3]!.id, t[0]!.id], statusId: st, index: 0 }))[0]).toBe(
      200,
    );
    expect(await column(st)).toEqual([t[3]!.id, t[0]!.id, t[1]!.id, t[2]!.id]);
    // before — одна из переносимых: перед следующей оставшейся
    await move(admin, { taskIds: [t[1]!.id, t[3]!.id], statusId: st, before: t[3]!.id });
    expect(await column(st)).toEqual([t[1]!.id, t[3]!.id, t[0]!.id, t[2]!.id]);
  });

  it('отказ: все проблемы списком, ничего не изменилось', async () => {
    const st = w.statusIds[4]!;
    const ok = await mk('ok');
    const gone = await mk('gone');
    await rest(admin, 'POST', `/tasks/${gone.id}/archive`);
    const pid = uuidv7();
    const other = Array.from({ length: 5 }, () => uuidv7());
    await w.admin.ok('project.create', {
      id: pid,
      spaceId: w.spaceId,
      name: 'Q',
      key: key(),
      rank: 'a1',
      statusIds: other,
    });
    const [, foreign] = await rest(admin, 'POST', '/tasks', { projectId: pid, title: 'F' });
    const before = await get(ok.id);
    const [s, e] = await move(admin, {
      taskIds: [ok.id, gone.id, foreign.data.id, ok.key, 'NOPE-1'],
      statusId: st,
    });
    expect(s).toBe(409);
    expect(e.code).toBe('conflict');
    expect(e.details.tasks).toEqual([
      { task: gone.id, code: 'archived', message: expect.any(String) },
      { task: foreign.data.id, code: 'other_project', message: expect.any(String) },
      { task: ok.key, code: 'duplicate', message: expect.any(String) },
      { task: 'NOPE-1', code: 'not_found', message: expect.any(String) },
    ]);
    expect(await get(ok.id)).toEqual(before);
    // the status is not visible — 404; a read token — 403
    expect((await move(outsider, { taskIds: [ok.id], statusId: st }))[0]).toBe(404);
    expect((await move(read, { taskIds: [ok.id], statusId: st }))[0]).toBe(403);
  });

  it('отказ по правам: гость получает forbidden по каждой задаче', async () => {
    const guest = await issue(w.guest.userId, 'write');
    const [a, b] = [await mk('G1'), await mk('G2')];
    const was = await get(a.id);
    const [s, e] = await move(guest, { taskIds: [a.id, b.id], statusId: w.statusIds[1] });
    expect(s).toBe(409);
    expect(e.details.tasks.map((p: { code: string }) => p.code)).toEqual([
      'forbidden',
      'forbidden',
    ]);
    expect(await get(a.id)).toEqual(was);
  });

  it('сбой посередине — откат всей транзакции', async () => {
    const st = w.statusIds[1]!;
    const t = [await mk('R1'), await mk('R2'), await mk('R3')];
    const was = await Promise.all(t.map((x) => get(x.id)));
    const def = domainMutators.find((m) => m.name === 'task.update')!;
    const run = def.run.bind(def);
    let n = 0;
    const spy = vi.spyOn(def, 'run').mockImplementation(async (tx, a, ctx) => {
      if (++n === 2) throw new Error('сбой');
      return run(tx, a, ctx);
    });
    try {
      const [s] = await move(admin, { taskIds: t.map((x) => x.id), statusId: st });
      expect(s).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(n).toBe(2);
    expect(await Promise.all(t.map((x) => get(x.id)))).toEqual(was);
  });
});
