import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTokenCreatedSchema } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { area } from '../../src/rest/ext/attachments.js';
import { downloadUrl, isBlockedIp } from '../../src/rest/ext/attachments.service.js';
import { RestService } from '../../src/rest/rest.service.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, world, type World } from '../sync/helpers.js';

// PLNRAPP-273 (AT-1): task attachments over REST v1 and MCP, as the user
const PARITY_ATTACHMENTS: Record<string, string> = {
  'GET /api/v1/tasks/{task}/attachments': 'list_task_attachments',
  'POST /api/v1/tasks/{task}/attachments': 'add_task_attachment',
  'DELETE /api/v1/attachments/{id}': 'delete_attachment',
};

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
let w: World;
let admin: string;
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
  app = await createApp({
    databaseUrl: dbUrl,
    publicUrl: ORIGIN,
    dataDir: await mkdtemp(join(tmpdir(), 'att-')),
    maxUploadMb: 1,
  });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  w = await world(db);
  admin = await issue(w.admin.userId, 'write');
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

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('вложения задач (ext/attachments)', () => {
  it('PARITY_ATTACHMENTS равен операциям области; удаление — danger delete', () => {
    expect(
      Object.fromEntries(area.ops.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o.tool])),
    ).toEqual(PARITY_ATTACHMENTS);
    const defs = toolDefs(app.get(RestService));
    expect(defs.find((d) => d.name === 'delete_attachment')?.danger).toBe('delete');
    expect(defs.find((d) => d.name === 'list_task_attachments')?.write).toBe(false);
  });

  it('base64: добавить → список (без содержимого) → удалить; лимит и ошибки входа', async () => {
    const call = await mcp(admin);
    const [, t] = await call('create_task', { projectId: w.projectId, title: 'С файлом' });
    const [e0, a] = await call('add_task_attachment', {
      task: t.id,
      name: 'a.txt',
      mime: 'text/plain',
      dataBase64: b64('привет'),
    });
    expect(e0, JSON.stringify(a)).toBe(false);
    expect([a.name, a.mime, a.size, a.taskId, a.uploadedBy]).toEqual([
      'a.txt',
      'text/plain',
      Buffer.byteLength('привет'),
      t.id,
      w.admin.userId,
    ]);
    const [, list] = await call('list_task_attachments', { task: t.id });
    expect(list.map((x: { id: string }) => x.id)).toEqual([a.id]);
    expect(JSON.stringify(list)).not.toContain(b64('привет'));

    const [e1, none] = await call('add_task_attachment', { task: t.id, name: 'x' });
    expect([e1, none.code]).toEqual([true, 'invalid_request']);
    const [, both] = await call('add_task_attachment', {
      task: t.id,
      name: 'x',
      dataBase64: 'AA==',
      url: 'https://example.com/x',
    });
    expect(both.code).toBe('invalid_request');
    // over the 1 MB limit (the HTTP body limit is the same size, so 413 either way)
    expect(
      (
        await rest(admin, 'POST', `/tasks/${t.id}/attachments`, {
          name: 'big',
          dataBase64: 'A'.repeat(1_500_000),
        })
      )[0],
    ).toBe(413);

    // REST: the same operation
    const [s1, b1] = await rest(admin, 'POST', `/tasks/${t.id}/attachments`, {
      name: 'b.bin',
      dataBase64: b64('x'),
    });
    expect(s1).toBe(201);
    expect(b1.data.mime).toBe('application/octet-stream');
    expect((await rest(admin, 'DELETE', `/attachments/${b1.data.id}`))[0]).toBe(204);
    expect((await call('delete_attachment', { id: a.id }))[0]).toBe(false);
    expect((await call('delete_attachment', { id: a.id }))[1].code).toBe('not_found');
    expect((await call('list_task_attachments', { task: t.id }))[1]).toEqual([]);
  });

  it('url: внутренние адреса и не-http отклоняются (SSRF)', async () => {
    const call = await mcp(admin);
    const [, t] = await call('create_task', { projectId: w.projectId, title: 'SSRF' });
    for (const url of [
      'http://127.0.0.1:1/x',
      'http://localhost/x',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/x',
      'http://[::ffff:10.0.0.1]/x',
      'http://10.1.2.3/x',
      'file:///etc/passwd',
      'ftp://example.com/x',
      'http://user:pw@example.com/x',
      'не url',
    ]) {
      const [e, r] = await call('add_task_attachment', { task: t.id, name: 'x', url });
      expect([url, e, r.code]).toEqual([url, true, 'invalid_request']);
    }
    expect((await call('list_task_attachments', { task: t.id }))[1]).toEqual([]);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('172.31.0.1')).toBe(true);
    expect(isBlockedIp('fd00::1')).toBe(true);
    expect(isBlockedIp('64:ff9b::7f00:1')).toBe(true);
  });

  it('downloadUrl: лимит размера, редирект и не-200 не принимаются; localhost — только с allowPrivate', async () => {
    const srv = createServer((req, res) => {
      if (req.url === '/ok') res.setHeader('content-type', 'image/png; x=1').end('12345');
      else if (req.url === '/big') res.end('x'.repeat(100));
      else if (req.url === '/redir') res.writeHead(302, { location: 'http://10.0.0.1/' }).end();
      else res.writeHead(404).end();
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const u = (p: string) => `http://localhost:${(srv.address() as AddressInfo).port}${p}`;
    try {
      const ok = await downloadUrl(u('/ok'), 10, true);
      expect([ok.buf.toString(), ok.mime]).toEqual(['12345', 'image/png']);
      await expect(downloadUrl(u('/big'), 10, true)).rejects.toMatchObject({ status: 413 });
      await expect(downloadUrl(u('/redir'), 10, true)).rejects.toMatchObject({ status: 400 });
      await expect(downloadUrl(u('/nope'), 10, true)).rejects.toMatchObject({ status: 400 });
      await expect(downloadUrl(u('/ok'), 10)).rejects.toMatchObject({ status: 400 });
    } finally {
      srv.close();
    }
  });

  it('отказы: чужой — not_found, токен read — forbidden', async () => {
    const call = await mcp(admin);
    const [, t] = await call('create_task', { projectId: w.projectId, title: 'Чужая' });
    const [, a] = await call('add_task_attachment', { task: t.id, name: 'a', dataBase64: 'AA==' });
    const out = await mcp(outsider);
    for (const [tool, args] of [
      ['list_task_attachments', { task: t.id }],
      ['add_task_attachment', { task: t.id, name: 'x', dataBase64: 'AA==' }],
      ['delete_attachment', { id: a.id }],
    ] as const) {
      const [e, r] = await out(tool, args);
      expect([tool, e, r.code]).toEqual([tool, true, 'not_found']);
    }
    const ro = await mcp(read);
    for (const [tool, args] of [
      ['add_task_attachment', { task: t.id, name: 'x', dataBase64: 'AA==' }],
      ['delete_attachment', { id: a.id }],
    ] as const) {
      const [e, r] = await ro(tool, args);
      expect([tool, e, r.code]).toEqual([tool, true, 'forbidden']);
    }
    expect((await ro('list_task_attachments', { task: t.id }))[0]).toBe(false);
    expect((await rest(read, 'POST', `/tasks/${t.id}/attachments`, { name: 'x' }))[0]).toBe(403);
    expect((await rest(outsider, 'GET', `/tasks/${t.id}/attachments`))[0]).toBe(404);
    expect((await call('list_task_attachments', { task: t.id }))[1]).toHaveLength(1);
  });
});
