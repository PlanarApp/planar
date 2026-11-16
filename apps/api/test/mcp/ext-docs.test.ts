import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { apiTokenCreatedSchema, uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { area } from '../../src/rest/ext/docs.js';
import { RestService } from '../../src/rest/rest.service.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, doc, newDb, taskArgs, world, type World } from '../sync/helpers.js';

// PLNRAPP-277 (DC-1): docs — move, archive, lock, versions, page comments over REST v1 and MCP, as the user
const PARITY_DOCS: Record<string, string> = {
  'POST /api/v1/docs/{id}/move': 'move_doc',
  'POST /api/v1/docs/{id}/archive': 'archive_doc',
  'POST /api/v1/docs/{id}/restore': 'restore_doc',
  'DELETE /api/v1/docs/{id}': 'delete_doc',
  'POST /api/v1/docs/{id}/lock': 'lock_doc',
  'DELETE /api/v1/docs/{id}/lock': 'unlock_doc',
  'GET /api/v1/docs/{id}/versions': 'list_doc_versions',
  'POST /api/v1/doc-versions/{id}/restore': 'restore_doc_version',
  'PATCH /api/v1/doc-comments/{id}': 'update_doc_comment',
  'DELETE /api/v1/doc-comments/{id}': 'delete_doc_comment',
  'PUT /api/v1/doc-comments/{id}/assignee': 'assign_doc_comment',
  'DELETE /api/v1/docs/{id}/tasks/{task}': 'unlink_doc_task',
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

const mkPage = async (parentId: string | null, title: string, rank = 'a0') => {
  const id = uuidv7();
  await w.admin.ok('docs.page.create', {
    id,
    spaceId: w.spaceId,
    projectId: w.projectId,
    parentId,
    rank,
    title,
    body: doc(title),
  });
  return id;
};

describe('документы: перенос, архив, версии, комментарии (ext/docs)', () => {
  it('PARITY_DOCS равен операциям области; удаления — danger delete, чтение — без write', () => {
    expect(
      Object.fromEntries(area.ops.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o.tool])),
    ).toEqual(PARITY_DOCS);
    const defs = toolDefs(app.get(RestService));
    for (const o of area.ops.filter((x) => x.method === 'delete'))
      expect(defs.find((d) => d.name === o.tool)?.danger, o.tool).toBe('delete');
    expect(defs.find((d) => d.name === 'list_doc_versions')?.write).toBe(false);
  });

  it('перенос, архив, восстановление, удаление, блокировка', async () => {
    const call = await mcp(admin);
    const a = await mkPage(null, 'A');
    const b = await mkPage(a, 'B');
    const [e0, moved] = await call('move_doc', { id: b, parentId: null });
    expect([e0, moved.parentId, moved.body], JSON.stringify(moved)).toEqual([
      false,
      null,
      undefined,
    ]);
    const [, into] = await call('move_doc', { id: b, parentId: a });
    expect(into.parentId).toBe(a);

    expect((await call('delete_doc', { id: a }))[1].code).toBe('conflict');
    const [e1, arch] = await call('archive_doc', { id: a });
    expect([e1, !!arch.archivedAt], JSON.stringify(arch)).toEqual([false, true]);
    expect((await call('move_doc', { id: a, parentId: null }))[1].code).toBe('conflict');
    const [e2, back] = await call('restore_doc', { id: a });
    expect([e2, back.archivedAt], JSON.stringify(back)).toEqual([false, null]);

    const [e3, lk] = await call('lock_doc', { id: a });
    expect([e3, lk.userId], JSON.stringify(lk)).toEqual([false, w.admin.userId]);
    const other = await mcp(member);
    expect((await other('lock_doc', { id: a }))[1].code).toBe('conflict');
    expect((await call('unlock_doc', { id: a }))[0]).toBe(false);
    expect((await other('lock_doc', { id: a }))[0]).toBe(false);

    await call('archive_doc', { id: a });
    expect((await call('delete_doc', { id: a }))[0]).toBe(false);
    expect((await call('delete_doc', { id: a }))[1].code).toBe('not_found');
    expect((await rest(admin, 'GET', `/docs/${b}/versions`))[0]).toBe(404);
  });

  it('версии: список и восстановление', async () => {
    const call = await mcp(admin);
    const p = await mkPage(null, 'V1');
    // правки одного автора за 10 минут сливаются в одну версию — вторая версия от другого автора
    await w.member.ok('docs.page.update', { id: p, body: doc('V2') });
    const [e0, list] = await call('list_doc_versions', { id: p });
    expect(e0, JSON.stringify(list)).toBe(false);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0].body).toBeUndefined();
    const old = list.at(-1);
    const [e1, res] = await call('restore_doc_version', { id: old.id });
    expect(e1, JSON.stringify(res)).toBe(false);
    const rows = (await db.execute(sql`select text from docs_pages where id = ${p}`)).rows as {
      text: string;
    }[];
    expect(rows[0]!.text).toContain('V1');
    expect((await call('restore_doc_version', { id: uuidv7() }))[1].code).toBe('not_found');
  });

  it('комментарии и связь с задачей', async () => {
    const p = await mkPage(null, 'C');
    const cid = uuidv7();
    await w.member.ok('docs.comment.create', { id: cid, pageId: p, body: doc('один') });
    const mem = await mcp(member);
    const [e0, up] = await mem('update_doc_comment', { id: cid, text: 'два' });
    expect([e0, !!up.editedAt], JSON.stringify(up)).toEqual([false, true]);
    const adm = await mcp(admin);
    expect((await adm('update_doc_comment', { id: cid, text: 'x' }))[1].code).toBe('forbidden');
    const [e1, as] = await adm('assign_doc_comment', { id: cid, assigneeId: w.admin.userId });
    expect([e1, as.assigneeId], JSON.stringify(as)).toEqual([false, w.admin.userId]);
    const [e2, bad] = await adm('assign_doc_comment', { id: cid, assigneeId: w.guest.userId });
    expect([e2, bad.code]).toEqual([true, 'invalid_request']);
    expect(
      (await adm('assign_doc_comment', { id: cid, assigneeId: null }))[1].assigneeId,
    ).toBeNull();
    expect((await adm('delete_doc_comment', { id: cid }))[1].code).toBe('forbidden');
    expect((await mem('delete_doc_comment', { id: cid }))[0]).toBe(false);
    expect((await mem('delete_doc_comment', { id: cid }))[1].code).toBe('not_found');

    const tid = uuidv7();
    await w.admin.ok('task.create', taskArgs(w, { id: tid }));
    await w.admin.ok('docs.link.add', { id: uuidv7(), pageId: p, taskId: tid });
    expect((await adm('unlink_doc_task', { id: p, task: tid }))[0]).toBe(false);
    const n = (await db.execute(sql`select 1 from docs_task_links where page_id = ${p}`)).rows
      .length;
    expect(n).toBe(0);
  });

  it('отказы: чужой — not_found, токен read — forbidden', async () => {
    const p = await mkPage(null, 'D');
    const cid = uuidv7();
    await w.member.ok('docs.comment.create', { id: cid, pageId: p, body: doc('к') });
    await w.admin.ok('docs.page.update', { id: p, body: doc('D2') });
    const [, ver] = await (await mcp(admin))('list_doc_versions', { id: p });
    const tid = uuidv7();
    await w.admin.ok('task.create', taskArgs(w, { id: tid }));
    const out = await mcp(outsider);
    for (const [tool, args] of [
      ['move_doc', { id: p, parentId: null }],
      ['archive_doc', { id: p }],
      ['restore_doc', { id: p }],
      ['delete_doc', { id: p }],
      ['lock_doc', { id: p }],
      ['unlock_doc', { id: p }],
      ['list_doc_versions', { id: p }],
      ['restore_doc_version', { id: ver[0].id }],
      ['update_doc_comment', { id: cid, text: 'x' }],
      ['delete_doc_comment', { id: cid }],
      ['assign_doc_comment', { id: cid, assigneeId: null }],
      ['unlink_doc_task', { id: p, task: tid }],
    ] as const) {
      const [e, r] = await out(tool, args);
      expect([tool, e, r.code]).toEqual([tool, true, 'not_found']);
    }
    const ro = await mcp(read);
    for (const o of area.ops.filter((x) => x.write)) {
      const [e, r] = await ro(o.tool, {
        id: ver[0].id,
        task: tid,
        parentId: null,
        text: 'x',
        assigneeId: null,
      });
      expect([o.tool, e, r.code]).toEqual([o.tool, true, 'forbidden']);
    }
    expect((await ro('list_doc_versions', { id: p }))[0]).toBe(false);
  });
});
