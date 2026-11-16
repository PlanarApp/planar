import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTokenCreatedSchema } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { area } from '../../src/rest/ext/planning.js';
import { RestService } from '../../src/rest/rest.service.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, taskArgs, world, type World } from '../sync/helpers.js';
import { sql } from 'drizzle-orm';
import { uuidv7 } from '@planar/shared';

// PLNRAPP-275 (PL-1): cycles, goals, key results and milestones over REST v1 and MCP, as the user
const PARITY_PLANNING: Record<string, string> = {
  'PUT /api/v1/projects/{id}/sprints/settings': 'configure_sprints',
  'POST /api/v1/projects/{id}/cycles': 'create_sprint',
  'PATCH /api/v1/cycles/{id}': 'update_sprint',
  'DELETE /api/v1/cycles/{id}': 'delete_sprint',
  'POST /api/v1/cycles/{id}/close': 'close_sprint',
  'PUT /api/v1/tasks/{task}/cycle': 'set_task_sprint',
  'GET /api/v1/spaces/{id}/goals': 'list_goals',
  'POST /api/v1/spaces/{id}/goals': 'create_goal',
  'PATCH /api/v1/goals/{id}': 'update_goal',
  'DELETE /api/v1/goals/{id}': 'delete_goal',
  'POST /api/v1/goals/{id}/key-results': 'create_key_result',
  'PATCH /api/v1/key-results/{id}': 'update_key_result',
  'DELETE /api/v1/key-results/{id}': 'delete_key_result',
  'GET /api/v1/projects/{id}/milestones': 'list_milestones',
  'POST /api/v1/projects/{id}/milestones': 'create_milestone',
  'PATCH /api/v1/milestones/{id}': 'update_milestone',
  'DELETE /api/v1/milestones/{id}': 'delete_milestone',
  'PUT /api/v1/tasks/{task}/milestone': 'set_task_milestone',
};

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
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
  base = await app.getUrl();
  w = await world(db);
  admin = await issue(w.admin.userId, 'write');
  member = await issue(w.member.userId, 'write');
  read = await issue(w.admin.userId, 'read');
  outsider = await issue(w.outsider.userId, 'write');
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

const dayOf = (n: number) => new Date(Date.UTC(2031, 0, 1 + n)).toISOString().slice(0, 10);

describe('циклы, цели и вехи (ext/planning)', () => {
  it('PARITY_PLANNING равен операциям области; удаления — danger delete, чтение — без write', () => {
    expect(
      Object.fromEntries(area.ops.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o.tool])),
    ).toEqual(PARITY_PLANNING);
    const defs = toolDefs(app.get(RestService));
    for (const o of area.ops.filter((x) => x.method === 'delete'))
      expect(defs.find((d) => d.name === o.tool)?.danger, o.tool).toBe('delete');
    for (const t of ['list_goals', 'list_milestones'])
      expect(defs.find((d) => d.name === t)?.write, t).toBe(false);
  });

  it('циклы: настроить → создать → изменить → задача в цикл → закрыть → удалить', async () => {
    const call = await mcp(admin);
    const [e0, cfg] = await call('configure_sprints', { id: w.projectId, lengthDays: 7 });
    expect([e0, cfg.lengthDays], JSON.stringify(cfg)).toEqual([false, 7]);
    const [e1, c1] = await call('create_sprint', {
      id: w.projectId,
      startDate: dayOf(0),
      name: 'Один',
    });
    expect(e1, JSON.stringify(c1)).toBe(false);
    expect([c1.endDate, c1.number]).toEqual([dayOf(6), 1]);
    const [e2, bad] = await call('create_sprint', { id: w.projectId, startDate: dayOf(3) });
    expect([e2, bad.code]).toEqual([true, 'conflict']);
    expect((await call('update_sprint', { id: c1.id, name: 'Спринт' }))[1].name).toBe('Спринт');

    const tid = uuidv7();
    await w.admin.ok('task.create', taskArgs(w, { id: tid }));
    const [e3, st] = await call('set_task_sprint', { task: tid, cycleId: c1.id });
    expect([e3, st.cycleId], JSON.stringify(st)).toEqual([false, c1.id]);
    const [, cur] = await rest(admin, 'GET', `/projects/${w.projectId}/cycles`);
    expect(cur.data.map((c: { id: string }) => c.id)).toContain(c1.id);

    const [e4, closed] = await call('close_sprint', { id: c1.id });
    expect([e4, !!closed.closedAt], JSON.stringify(closed)).toEqual([false, true]);
    expect((await call('update_sprint', { id: c1.id, name: 'x' }))[1].code).toBe('conflict');
    const [, c2] = await rest(admin, 'GET', `/projects/${w.projectId}/cycles`);
    const next = c2.data.find((c: { id: string }) => c.id !== c1.id);
    expect(next.number).toBe(2);
    expect((await call('set_task_sprint', { task: tid, cycleId: null }))[0]).toBe(false);
    expect((await call('delete_sprint', { id: next.id }))[0]).toBe(false);
    expect((await rest(admin, 'DELETE', `/cycles/${c1.id}`))[0]).toBe(204);
    expect((await call('delete_sprint', { id: c1.id }))[1].code).toBe('not_found');
  });

  it('цели и KR: создать → изменить → архив → удалить', async () => {
    const call = await mcp(member);
    const [e0, g] = await call('create_goal', { id: w.spaceId, name: 'Цель', dueDate: dayOf(30) });
    expect(e0, JSON.stringify(g)).toBe(false);
    expect((await call('update_goal', { id: g.id, ownerId: w.member.userId }))[1].ownerId).toBe(
      w.member.userId,
    );
    const [e1, kr] = await call('create_key_result', {
      id: g.id,
      name: 'Число',
      kind: 'number',
      metric: { start: 0, target: 10, current: 2, unit: null },
    });
    expect(e1, JSON.stringify(kr)).toBe(false);
    const [e2, bad] = await call('create_key_result', { id: g.id, name: 'x', kind: 'tasks' });
    expect([e2, bad.code]).toEqual([true, 'invalid_request']);
    const [e3, kr2] = await call('update_key_result', {
      id: kr.id,
      metric: { start: 0, target: 10, current: 5, unit: null },
    });
    expect([e3, kr2.metric.current], JSON.stringify(kr2)).toEqual([false, 5]);
    const [, list] = await call('list_goals', { id: w.spaceId });
    expect(list.find((x: { id: string }) => x.id === g.id).keyResults).toHaveLength(1);
    expect((await call('update_goal', { id: g.id, archived: true }))[1].archivedAt).toBeTruthy();
    expect(
      (await call('list_goals', { id: w.spaceId }))[1].some((x: { id: string }) => x.id === g.id),
    ).toBe(false);
    expect(
      (await call('list_goals', { id: w.spaceId, archived: true }))[1].some(
        (x: { id: string }) => x.id === g.id,
      ),
    ).toBe(true);
    expect((await call('delete_key_result', { id: kr.id }))[0]).toBe(false);
    expect((await rest(member, 'DELETE', `/goals/${g.id}`))[0]).toBe(204);
    expect((await call('delete_goal', { id: g.id }))[1].code).toBe('not_found');
  });

  it('вехи: создать → задача в веху → список → снять → удалить', async () => {
    const call = await mcp(admin);
    const [e0, ms] = await call('create_milestone', {
      id: w.projectId,
      name: 'Релиз',
      date: dayOf(10),
    });
    expect(e0, JSON.stringify(ms)).toBe(false);
    expect((await call('update_milestone', { id: ms.id, date: dayOf(12) }))[1].date).toBe(
      dayOf(12),
    );
    const tid = uuidv7();
    await w.admin.ok('task.create', taskArgs(w, { id: tid }));
    const [e1, set] = await call('set_task_milestone', { task: tid, milestoneId: ms.id });
    expect([e1, set.milestoneId], JSON.stringify(set)).toEqual([false, ms.id]);
    const [, list] = await call('list_milestones', { id: w.projectId });
    expect(list.find((x: { id: string }) => x.id === ms.id).taskIds).toEqual([tid]);
    expect((await call('set_task_milestone', { task: tid, milestoneId: null }))[0]).toBe(false);
    expect((await call('delete_milestone', { id: ms.id }))[0]).toBe(false);
    expect((await call('delete_milestone', { id: ms.id }))[1].code).toBe('not_found');
  });

  it('отказы: чужой — not_found, токен read — forbidden, модуль выключен — module_disabled', async () => {
    const adm = await mcp(admin);
    const [, c] = await adm('create_sprint', { id: w.projectId, startDate: dayOf(100) });
    const [, g] = await adm('create_goal', { id: w.spaceId, name: 'Ц' });
    const [, k] = await adm('create_key_result', {
      id: g.id,
      name: 'K',
      kind: 'number',
      metric: { start: 0, target: 1, current: 0, unit: null },
    });
    const [, m] = await adm('create_milestone', { id: w.projectId, name: 'В', date: dayOf(1) });
    const out = await mcp(outsider);
    const tid = uuidv7();
    await w.admin.ok('task.create', taskArgs(w, { id: tid }));
    for (const [tool, args] of [
      ['configure_sprints', { id: w.projectId, lengthDays: 3 }],
      ['create_sprint', { id: w.projectId, startDate: dayOf(200) }],
      ['update_sprint', { id: c.id, name: 'x' }],
      ['delete_sprint', { id: c.id }],
      ['close_sprint', { id: c.id }],
      ['set_task_sprint', { task: tid, cycleId: c.id }],
      ['list_goals', { id: w.spaceId }],
      ['create_goal', { id: w.spaceId, name: 'x' }],
      ['update_goal', { id: g.id, name: 'x' }],
      ['delete_goal', { id: g.id }],
      ['create_key_result', { id: g.id, name: 'x', kind: 'number', metric: k.metric }],
      ['update_key_result', { id: k.id, name: 'x' }],
      ['delete_key_result', { id: k.id }],
      ['list_milestones', { id: w.projectId }],
      ['create_milestone', { id: w.projectId, name: 'x', date: dayOf(1) }],
      ['update_milestone', { id: m.id, name: 'x' }],
      ['delete_milestone', { id: m.id }],
      ['set_task_milestone', { task: tid, milestoneId: m.id }],
    ] as const) {
      const [e, r] = await out(tool, args);
      expect([tool, e, r.code]).toEqual([tool, true, 'not_found']);
    }
    const ro = await mcp(read);
    for (const o of area.ops.filter((x) => x.write)) {
      const [e, r] = await ro(o.tool, {
        id: w.projectId,
        task: tid,
        cycleId: null,
        milestoneId: null,
        kind: 'number',
        startDate: dayOf(300),
        name: 'x',
        date: dayOf(1),
      });
      expect([o.tool, e, r.code]).toEqual([o.tool, true, 'forbidden']);
    }
    expect((await ro('list_goals', { id: w.spaceId }))[0]).toBe(false);
    expect((await rest(read, 'POST', `/spaces/${w.spaceId}/goals`, { name: 'x' }))[0]).toBe(403);

    // module off in the project: cycles and milestones are 404 module_disabled
    const off = uuidv7();
    await w.admin.ok('project.create', {
      id: off,
      spaceId: w.spaceId,
      name: 'Off',
      key: 'OFFP',
      rank: 'a1',
      statusIds: Array.from({ length: 5 }, () => uuidv7()),
    });
    await db.execute(sql`update projects set modules = '{}' where id = ${off}`);
    for (const [tool, args] of [
      ['create_sprint', { id: off, startDate: dayOf(1) }],
      ['configure_sprints', { id: off, lengthDays: 3 }],
      ['list_milestones', { id: off }],
      ['create_milestone', { id: off, name: 'x', date: dayOf(1) }],
    ] as const) {
      const [e, r] = await adm(tool, args);
      expect([tool, e, r.code]).toEqual([tool, true, 'module_disabled']);
    }
  });
});
