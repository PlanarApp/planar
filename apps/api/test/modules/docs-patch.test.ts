import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { apiTokenCreatedSchema, uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, world, type World } from '../sync/helpers.js';

// docai-patch v1: applyPagePatch + REST v1 page comments / patch
const db = newDb();
let w: World;
let app: Awaited<ReturnType<typeof createApp>>;
let token: string;
const cookies: Record<string, string> = {};

const para = (...content: object[]) => ({ type: 'paragraph', content });
const text = (t: string) => ({ type: 'text', text: t });
const http = (method: 'GET' | 'POST', url: string, who: string, payload?: unknown) =>
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
const mk = async (...content: object[]) => {
  const id = uuidv7();
  await w.member.ok('docs.page.create', {
    id,
    spaceId: w.spaceId,
    projectId: w.projectId,
    rank: 'a0',
    body: { type: 'doc', content },
  });
  return id;
};
const patch = (id: string, edits: object[], who = 'token') =>
  http('POST', `/api/v1/docs/${id}/patch`, who, { edits });
const pageText = async (id: string) =>
  (
    (await db.execute(sql`select text from docs_pages where id = ${id}`)).rows[0] as {
      text: string;
    }
  ).text;
const versions = async (id: string) =>
  (await db.execute(sql`select id from docs_versions where page_id = ${id}`)).rows.length;

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

describe('docs: патч страницы', () => {
  it('успех: заменяет фрагмент, версия попадает в историю', async () => {
    const id = await mk(para(text('Срок: пятница')), para(text('Хвост')));
    const r = await patch(id, [{ find: 'пятница', replace: 'понедельник' }]);
    expect(r.statusCode, r.body).toBe(200);
    const d = r.json().data;
    expect(d.ok).toBe(true);
    expect(d.versionId).toBeTruthy();
    expect(await pageText(id)).toContain('Срок: понедельник');
    expect(await pageText(id)).toContain('Хвост');
    expect(await versions(id)).toBeGreaterThan(0);
  });

  it('not_found / ambiguous / all / empty; при ошибке страница не меняется', async () => {
    const id = await mk(para(text('кот и кот')));
    const before = await pageText(id);
    const nf = await patch(id, [{ find: 'пёс', replace: 'x' }]);
    expect([nf.statusCode, nf.json().code]).toEqual([400, 'patch_not_found']);
    const amb = await patch(id, [{ find: 'кот', replace: 'x' }]);
    expect(amb.json().code).toBe('patch_ambiguous');
    // the second edit fails — the first is not written either
    const half = await patch(id, [
      { find: 'кот и', replace: 'пёс и' },
      { find: 'нет такого', replace: 'x' },
    ]);
    expect(half.json().code).toBe('patch_not_found');
    expect(await pageText(id)).toBe(before);
    expect((await patch(id, [])).statusCode).toBe(400);
    expect((await patch(id, [{ find: '', replace: 'x' }])).statusCode).toBe(400);
    const all = await patch(id, [{ find: 'кот', replace: 'лис', all: true }]);
    expect(all.statusCode, all.body).toBe(200);
    expect(await pageText(id)).toContain('лис и лис');
  });

  it('упоминания: страница отклоняется целиком, ничего не записано', async () => {
    const id = await mk(
      para(text('Привет '), { type: 'mention', attrs: { id: w.admin.userId, label: 'admin' } }),
      para(text('правим это')),
    );
    const n = await versions(id);
    const r = await patch(id, [{ find: 'правим это', replace: 'x' }]);
    expect([r.statusCode, r.json().code]).toEqual([400, 'patch_mentions']);
    expect(await pageText(id)).toContain('правим это');
    expect(await versions(id)).toBe(n);
  });

  it('нет прав: guest — forbidden, посторонний — not_found; не запись не меняет страницу', async () => {
    const id = await mk(para(text('секрет')));
    const g = await patch(id, [{ find: 'секрет', replace: 'x' }], 'guest');
    expect(g.statusCode).toBe(403);
    const o = await patch(id, [{ find: 'секрет', replace: 'x' }], 'outsider');
    expect(o.statusCode).toBe(404);
    expect(await pageText(id)).toContain('секрет');
  });
});

describe('docs: комментарии страницы (REST)', () => {
  it('создать, ответить, назначить, выполнить; список в markdown; чужая страница — 404', async () => {
    const id = await mk(para(text('страница')));
    const root = await http('POST', `/api/v1/docs/${id}/comments`, 'token', {
      text: 'вопрос',
      assigneeId: w.member.userId,
    });
    expect(root.statusCode, root.body).toBe(201);
    const rid = root.json().data.id as string;
    const rep = await http('POST', `/api/v1/docs/${id}/comments`, 'token', {
      text: 'ответ',
      parentId: rid,
    });
    expect(rep.json().data.parentId).toBe(rid);
    const res = await http('POST', `/api/v1/docs/${id}/comments/${rid}/resolve`, 'token');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.resolved).toBe(true);
    const l = (await http('GET', `/api/v1/docs/${id}/comments`, 'token')).json().data;
    expect(l.map((c: { text: string; resolved: boolean }) => [c.text.trim(), c.resolved])).toEqual([
      ['вопрос', true],
      ['ответ', false],
    ]);
    expect((await http('GET', `/api/v1/docs/${id}/comments`, 'outsider')).statusCode).toBe(404);
    // a comment of another page
    const other = await mk(para(text('другая')));
    expect(
      (await http('POST', `/api/v1/docs/${other}/comments/${rid}/resolve`, 'token')).statusCode,
    ).toBe(404);
  });
});
