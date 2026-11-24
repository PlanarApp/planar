import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { apiTokenCreatedSchema, uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { area } from '../../src/rest/ext/integrations.js';
import { RestService } from '../../src/rest/rest.service.js';
import { createUser, ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, taskArgs, world, type World } from '../sync/helpers.js';

// PLNRAPP-279 (IG-1): automation runs, webhooks and import job status over REST v1 and MCP, as the user
const PARITY_INTEGRATIONS: Record<string, string> = {
  'GET /api/v1/automations/rules/{id}/runs': 'list_automation_runs',
  'GET /api/v1/webhooks/subscriptions': 'list_webhooks',
  'POST /api/v1/webhooks/subscriptions': 'create_webhook',
  'PATCH /api/v1/webhooks/subscriptions/{id}': 'update_webhook',
  'DELETE /api/v1/webhooks/subscriptions/{id}': 'delete_webhook',
  'POST /api/v1/webhooks/subscriptions/{id}/ping': 'ping_webhook',
  'GET /api/v1/webhooks/subscriptions/{id}/deliveries': 'list_webhook_deliveries',
  'POST /api/v1/webhooks/deliveries/{id}/redeliver': 'redeliver_webhook',
  'POST /api/v1/import/preview': 'preview_import',
  'POST /api/v1/import/jobs': 'start_import',
  'GET /api/v1/import/jobs/{id}': 'get_import_job',
};

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
let w: World;
let admin: string; // instance admin, write
let adminRead: string;
let member: string; // space member, instance role member
let outsider: string;
let ruleId: string;

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
  const adminId = (await createUser(db, { role: 'admin' })).id;
  admin = await issue(adminId, 'write');
  adminRead = await issue(adminId, 'read');
  member = await issue(w.member.userId, 'write');
  outsider = await issue(w.outsider.userId, 'write');
  ruleId = uuidv7();
  await w.admin.ok('automations.create', {
    id: ruleId,
    projectId: w.projectId,
    name: 'R',
    trigger: { type: 'task.created' },
    actions: [{ type: 'add_comment', text: 'x' }],
  });
  const tid = uuidv7();
  await w.admin.ok('task.create', taskArgs(w, { id: tid }));
  for (const status of ['ok', 'error'])
    await db.execute(
      sql`insert into automations_runs (id, rule_id, task_id, depth, status, error)
          values (${uuidv7()}, ${ruleId}, ${tid}, 0, ${status}, ${status === 'error' ? 'boom' : null})`,
    );
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
    const text = res.content[0]!.text;
    return [
      !!res.isError,
      text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text,
    ] as const;
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

describe('интеграции (ext/integrations)', () => {
  it('PARITY_INTEGRATIONS равен операциям области; удаление — danger delete, чтение — без write', () => {
    expect(
      Object.fromEntries(area.ops.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o.tool])),
    ).toEqual(PARITY_INTEGRATIONS);
    const defs = toolDefs(app.get(RestService));
    for (const t of ['delete_webhook', 'create_webhook', 'update_webhook'])
      expect(defs.find((d) => d.name === t)?.danger, t).toBe('delete');
    for (const t of [
      'list_automation_runs',
      'list_webhooks',
      'list_webhook_deliveries',
      'get_import_job',
      'preview_import',
    ])
      expect(defs.find((d) => d.name === t)?.write, t).toBe(false);
  });

  it('журнал автоматизаций: участник видит, лимит, чужой — not_found', async () => {
    const call = await mcp(member);
    const [e, runs] = await call('list_automation_runs', { id: ruleId });
    expect([e, runs.map((r: { status: string }) => r.status).sort()], JSON.stringify(runs)).toEqual(
      [false, ['error', 'ok']],
    );
    expect((await call('list_automation_runs', { id: ruleId, limit: 1 }))[1]).toHaveLength(1);
    expect((await call('list_automation_runs', { id: ruleId, limit: 500 }))[0]).toBe(true);
    const [, rr] = await rest(member, 'GET', `/automations/rules/${ruleId}/runs?limit=1`);
    expect(rr.data, JSON.stringify(rr)).toHaveLength(1);
    const [eo, ro] = await (await mcp(outsider))('list_automation_runs', { id: ruleId });
    expect([eo, ro.code]).toEqual([true, 'not_found']);

    await db.execute(sql`update projects set modules = '{}' where id = ${w.projectId}`);
    const [e2, r2] = await call('list_automation_runs', { id: ruleId });
    expect([e2, r2.code]).toEqual([true, 'module_disabled']);
    await db.execute(sql`update projects set modules = '{automations}' where id = ${w.projectId}`);
  });

  it('вебхуки: создать → список → изменить → ping → доставки → повтор → удалить, секрет не отдаётся', async () => {
    const call = await mcp(admin);
    const [e0, sub] = await call('create_webhook', {
      url: 'https://example.com/hook',
      events: ['task.created'],
      description: 'd',
    });
    expect(e0, JSON.stringify(sub)).toBe(false);
    const [, list] = await call('list_webhooks');
    expect(list.map((s: { id: string }) => s.id)).toContain(sub.id);
    expect(JSON.stringify([sub, list])).not.toMatch(/secret|whsec_/);
    const [, up] = await call('update_webhook', { id: sub.id, active: false, description: null });
    expect([up.active, up.description]).toEqual([false, null]);
    expect((await call('update_webhook', { id: sub.id, url: 'ftp://x' }))[0]).toBe(true);
    expect((await call('create_webhook', { url: 'https://u:p@x.io/', events: ['a'] }))[0]).toBe(
      true,
    );

    const [e1, ping] = await call('ping_webhook', { id: sub.id });
    expect([e1, ping.event, ping.status], JSON.stringify(ping)).toEqual([false, 'ping', 'pending']);
    const [e2, re] = await call('redeliver_webhook', { id: ping.id });
    expect([e2, re.event, re.id === ping.id], JSON.stringify(re)).toEqual([false, 'ping', false]);
    const [, p1] = await call('list_webhook_deliveries', { id: sub.id, limit: 1 });
    expect([p1.data, p1.nextCursor === null]).toMatchObject([[{ id: re.id }], false]);
    const [, p2] = await call('list_webhook_deliveries', {
      id: sub.id,
      limit: 1,
      cursor: p1.nextCursor,
    });
    expect([p2.data[0].id, p2.nextCursor]).toEqual([ping.id, null]);
    expect((await call('list_webhook_deliveries', { id: sub.id, cursor: 'x' }))[1].code).toBe(
      'invalid_request',
    );
    expect(JSON.stringify([p1, p2])).not.toMatch(/whsec_/);

    expect((await rest(admin, 'DELETE', `/webhooks/subscriptions/${sub.id}`))[0]).toBe(204);
    expect((await call('delete_webhook', { id: sub.id }))[1].code).toBe('not_found');
    expect((await call('ping_webhook', { id: sub.id }))[1].code).toBe('not_found');
  });

  it('вебхуки: не админ — forbidden, read-токен не пишет', async () => {
    const [, sub] = await (
      await mcp(admin)
    )('create_webhook', {
      url: 'https://example.com/h2',
      events: ['x'],
    });
    const m = await mcp(member);
    for (const [tool, args] of [
      ['list_webhooks', {}],
      ['create_webhook', { url: 'https://example.com/h', events: ['x'] }],
      ['update_webhook', { id: sub.id, active: false }],
      ['delete_webhook', { id: sub.id }],
      ['ping_webhook', { id: sub.id }],
      ['list_webhook_deliveries', { id: sub.id }],
      ['redeliver_webhook', { id: sub.id }],
    ] as const) {
      const [e, r] = await m(tool, args);
      expect([tool, e, r.code]).toEqual([tool, true, 'forbidden']);
    }
    expect((await rest(member, 'GET', '/webhooks/subscriptions'))[0]).toBe(403);
    const ro = await mcp(adminRead);
    for (const o of area.ops.filter((x) => x.write)) {
      const [e, r] = await ro(o.tool, {
        id: sub.id,
        url: 'https://example.com/h',
        events: ['x'],
        format: 'csv',
        preset: 'custom',
        content: 'Title\nx\n',
        mapping: { title: 'Title' },
        projectId: w.projectId,
      });
      expect([o.tool, e, r.code]).toEqual([o.tool, true, 'forbidden']);
    }
    expect((await ro('list_webhooks'))[0]).toBe(false);
  });

  it('импорт: статус своего задания без source/mapping, чужой — not_found', async () => {
    const jid = uuidv7();
    await db.execute(
      sql`insert into import_jobs (id, user_id, space_id, format, preset, status, total, source, mapping)
          values (${jid}, ${w.member.userId}, ${w.spaceId}, 'csv', 'custom', 'done', 3, 'a,b', '{"title":"a"}'::jsonb)`,
    );
    const call = await mcp(member);
    const [e, job] = await call('get_import_job', { id: jid });
    expect([e, job.status, job.total], JSON.stringify(job)).toEqual([false, 'done', 3]);
    expect(job).not.toHaveProperty('source');
    expect(job).not.toHaveProperty('mapping');
    expect((await rest(member, 'GET', `/import/jobs/${jid}`))[0]).toBe(200);
    const [eo, ro] = await (await mcp(outsider))('get_import_job', { id: jid });
    expect([eo, ro.code]).toEqual([true, 'not_found']);
  });

  it('импорт: предпросмотр → запуск → статус; отказы', async () => {
    const csv = 'Title,Status\nПервая,Open\nВторая,Done\n';
    const file = { format: 'csv', preset: 'custom', content: csv };
    const call = await mcp(member);
    const [e0, pv] = await call('preview_import', file);
    expect([e0, pv.columns, pv.rows.length], JSON.stringify(pv)).toEqual([
      false,
      ['Title', 'Status'],
      2,
    ]);
    expect((await call('preview_import', { ...file, content: '' }))[0]).toBe(true);
    expect((await call('preview_import', { ...file, preset: 'trello' }))[1].code).toBe(
      'invalid_request',
    );
    const mapping = { title: 'Title', status: 'Status' };
    const [e1, job] = await call('start_import', {
      ...file,
      mapping,
      projectId: w.projectId,
    });
    expect([e1, job.status, job.total], JSON.stringify(job)).toEqual([false, 'pending', 2]);
    expect(job).not.toHaveProperty('source');
    expect((await call('get_import_job', { id: job.id }))[1].id).toBe(job.id);
    // no project and no project column; `new` is not supported; foreign project
    expect((await call('start_import', { ...file, mapping, spaceId: w.spaceId }))[1].code).toBe(
      'invalid_request',
    );
    const withNew = { ...mapping, project: 'Title', projectMap: { Первая: 'new' } };
    expect(
      (await call('start_import', { ...file, mapping: withNew, spaceId: w.spaceId }))[1].code,
    ).toBe('invalid_request');
    const out = await mcp(outsider);
    for (const args of [
      { projectId: w.projectId },
      { spaceId: w.spaceId, mapping: { ...mapping, project: 'Title' } },
    ]) {
      const [e, r] = await out('start_import', { ...file, mapping, ...args });
      expect([e, r.code]).toEqual([true, 'not_found']);
    }
    const guest = await mcp(await issue(w.guest.userId, 'write'));
    expect(
      (await guest('start_import', { ...file, mapping, projectId: w.projectId }))[1].code,
    ).toBe('not_found');
  });
});
