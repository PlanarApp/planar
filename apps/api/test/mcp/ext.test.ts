import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiTokenCreatedSchema } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { buildExtOps, registerExtArea, type ExtOp } from '../../src/rest/ext/index.js';
import { openapi } from '../../src/rest/openapi.js';
import { RestService } from '../../src/rest/rest.service.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, world, type World } from '../sync/helpers.js';

// C-ext v1 (MA-1): one ExtOp → REST, OpenAPI, MCP and chat tools. Temporary ops, not in EXT_AREAS.
const echo: ExtOp = {
  tool: 'ext_test_echo',
  description: 'Тестовая: проект и q',
  method: 'get',
  path: '/api/v1/ext-test/{id}/echo',
  shape: { id: z.uuid(), q: z.string().optional() },
  write: false,
  run: async (d, uid, i) => {
    const a = i as { id: string; q?: string };
    return { project: await d.visibleProject(uid, a.id), q: a.q ?? null, origin: d.origin };
  },
};
const make: ExtOp = {
  tool: 'ext_test_make',
  description: 'Тестовая запись',
  method: 'post',
  path: '/api/v1/ext-test/{id}/items',
  shape: { id: z.uuid(), name: z.string().min(1) },
  write: true,
  status: 201,
  run: async (_d, _u, i) => ({ made: (i as { name: string }).name }),
};
const drop: ExtOp = {
  tool: 'ext_test_drop',
  description: 'Тестовое удаление',
  method: 'delete',
  path: '/api/v1/ext-test/{id}',
  shape: { id: z.uuid() },
  write: true,
  danger: 'delete',
  status: 204,
  run: async () => undefined,
};
registerExtArea({ name: 'test', ops: [echo, make, drop] });

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
let w: World;
let write: string;
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
  write = await issue(w.admin.userId, 'write');
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

type Op = {
  parameters: { name: string }[];
  responses: object;
  requestBody: { content: { 'application/json': { schema: { required: string[] } } } };
};

describe('C-ext: ExtOp', () => {
  it('REST: {data}, статус по ExtOp, путь и query сливаются, чужой — 404', async () => {
    const [s, b] = await rest(write, 'GET', `/ext-test/${w.projectId}/echo?q=a`);
    expect([s, b.data]).toEqual([200, { project: w.projectId, q: 'a', origin: ORIGIN }]);
    const [s2, b2] = await rest(write, 'POST', `/ext-test/${w.projectId}/items`, { name: 'x' });
    expect([s2, b2]).toEqual([201, { data: { made: 'x' } }]);
    expect((await rest(write, 'POST', `/ext-test/${w.projectId}/items`, {}))[1].code).toBe(
      'invalid_request',
    );
    const [s3, b3] = await rest(write, 'DELETE', `/ext-test/${w.projectId}`);
    expect([s3, b3]).toEqual([204, null]);
    expect((await rest(outsider, 'GET', `/ext-test/${w.projectId}/echo`))[0]).toBe(404);
    expect((await rest(write, 'GET', '/ext-test/nothing/here/at/all'))[0]).toBe(404);
  });

  it('read-токен на write — 403 в REST и MCP', async () => {
    expect((await rest(read, 'POST', `/ext-test/${w.projectId}/items`, { name: 'x' }))[0]).toBe(
      403,
    );
    expect((await rest(read, 'GET', `/ext-test/${w.projectId}/echo`))[0]).toBe(200);
    const call = await mcp(read);
    const [e, r] = await call('ext_test_make', { id: w.projectId, name: 'x' });
    expect([e, r.code]).toEqual([true, 'forbidden']);
  });

  it('MCP: тот же ExtOp; OpenAPI описывает путь; danger виден в toolDefs', async () => {
    const call = await mcp(write);
    const [e, r] = await call('ext_test_echo', { id: w.projectId });
    expect([e, r.project]).toEqual([false, w.projectId]);
    expect((await call('ext_test_drop', { id: w.projectId }))[1]).toEqual({ ok: true });
    const spec = openapi() as unknown as { paths: Record<string, Record<string, Op>> };
    const item = spec.paths['/api/v1/ext-test/{id}/items']!.post;
    expect(Object.keys(item.responses)).toContain('201');
    expect(item.requestBody.content['application/json'].schema.required).toEqual(['name']);
    expect(spec.paths['/api/v1/ext-test/{id}/echo']!.get.parameters.map((p) => p.name)).toEqual([
      'id',
      'q',
    ]);
    expect(Object.keys(spec.paths['/api/v1/ext-test/{id}']!.delete.responses)).toContain('204');
    const defs = toolDefs(app.get(RestService));
    expect(defs.find((d) => d.name === 'ext_test_drop')?.danger).toBe('delete');
    expect(defs.find((d) => d.name === 'ext_test_echo')?.write).toBe(false);
  });

  it('дубликат tool или METHOD+path — ошибка сборки', () => {
    expect(() =>
      buildExtOps([
        { name: 'a', ops: [echo] },
        { name: 'b', ops: [echo] },
      ]),
    ).toThrow(/duplicate tool/);
    expect(() => buildExtOps([{ name: 'a', ops: [echo, { ...echo, tool: 'other' }] }])).toThrow(
      /duplicate route/,
    );
    expect(() => registerExtArea({ name: 'dup', ops: [{ ...make, path: '/api/v1/x' }] })).toThrow(
      /duplicate tool/,
    );
  });
});
