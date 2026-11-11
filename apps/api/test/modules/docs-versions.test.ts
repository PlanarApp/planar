import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { apiTokenCreatedSchema, uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, world, type World } from '../sync/helpers.js';

// PLNRAPP-185: page version history — hook docs_versions, DocsController
const db = newDb();
let w: World;
let app: Awaited<ReturnType<typeof createApp>>;
let token: string;
const cookies: Record<string, string> = {};
type V = { id: string; source: string | null; createdBy: string; body?: unknown };

const body = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const http = (method: 'GET' | 'POST' | 'PATCH', url: string, who: string, payload?: unknown) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      headers:
        who === 'token'
          ? { authorization: `Bearer ${token}` }
          : { cookie: cookies[who]!, origin: ORIGIN },
      payload: payload as object,
    });
const list = async (id: string, who = 'member') =>
  (await http('GET', `/api/docs/pages/${id}/versions`, who)).json().data as V[];
const mk = async (text: string) => {
  const id = uuidv7();
  await w.member.ok('docs.page.create', {
    id,
    spaceId: w.spaceId,
    projectId: w.projectId,
    rank: 'a0',
    body: body(text),
  });
  return id;
};
const edit = (who: 'member' | 'admin', id: string, text: string) =>
  w[who].ok('docs.page.update', { id, body: body(text) });

beforeAll(async () => {
  w = await world(db);
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.init();
  for (const u of ['admin', 'member', 'guest', 'outsider'] as const)
    cookies[u] = await loginCookie(db, w[u].userId);
  const r = await http('POST', '/api/tokens', 'member', { name: 't', scope: 'write' });
  token = apiTokenCreatedSchema.parse(r.json()).secret;
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

describe('docs: история версий', () => {
  it('правки одного автора сливаются; другой автор, API и пауза — новая версия; без изменений — ничего', async () => {
    const id = await mk('v1');
    expect((await list(id)).map((v) => v.source)).toEqual(['editor']);
    await edit('member', id, 'v2');
    await edit('member', id, 'v3');
    expect(await list(id)).toHaveLength(1);
    await w.member.ok('docs.page.update', { id, title: 'только заголовок' });
    await edit('admin', id, 'v4');
    const r = await http('PATCH', `/api/v1/docs/${id}`, 'token', { append: 'v5' });
    expect(r.statusCode).toBe(200);
    const vs = await list(id);
    expect(vs.map((v) => [v.source, v.createdBy])).toEqual([
      ['api', w.member.userId],
      ['editor', w.admin.userId],
      ['editor', w.member.userId],
    ]);
    const one = (await http('GET', `/api/docs/versions/${vs[2]!.id}`, 'member')).json().data;
    expect(JSON.stringify(one.body)).toContain('v3');
    // a pause longer than the window
    await db.execute(
      sql`update docs_versions set created_at = now() - interval '11 minutes' where page_id = ${id}`,
    );
    await http('PATCH', `/api/v1/docs/${id}`, 'token', { append: 'v6' });
    expect(await list(id)).toHaveLength(4);
  });

  it('страница без истории: первая правка сохраняет прежнее тело (source null)', async () => {
    const id = await mk('старое');
    await db.execute(sql`delete from docs_versions where page_id = ${id}`);
    await edit('member', id, 'новое');
    const vs = await list(id);
    expect(vs.map((v) => v.source)).toEqual(['editor', null]);
    const old = (await http('GET', `/api/docs/versions/${vs[1]!.id}`, 'member')).json().data;
    expect(JSON.stringify(old.body)).toContain('старое');
  });

  it('восстановление: тело страницы = версия, версия «restore» без дубля; guest — forbidden; посторонний не видит', async () => {
    const id = await mk('исходник');
    await edit('admin', id, 'испорчено');
    const [, first] = await list(id);
    expect((await http('GET', `/api/docs/pages/${id}/versions`, 'outsider')).statusCode).toBe(404);
    expect((await http('GET', `/api/docs/versions/${first!.id}`, 'outsider')).statusCode).toBe(404);
    expect(
      (await http('POST', `/api/docs/versions/${first!.id}/restore`, 'guest')).statusCode,
    ).toBe(403);
    const r = await http('POST', `/api/docs/versions/${first!.id}/restore`, 'member');
    expect(r.statusCode, r.body).toBe(201);
    const p = await db.execute(sql`select text from docs_pages where id = ${id}`);
    expect((p.rows[0] as { text: string }).text).toBe('исходник');
    expect((await list(id)).map((v) => v.source)).toEqual(['restore', 'editor', 'editor']);
  });

  it('удаление страницы удаляет её версии', async () => {
    const id = await mk('на удаление');
    await w.member.ok('docs.page.archive', { id });
    await w.admin.ok('docs.page.delete', { id });
    const r = await db.execute(sql`select 1 from docs_versions where page_id = ${id}`);
    expect(r.rows).toHaveLength(0);
  });
});
