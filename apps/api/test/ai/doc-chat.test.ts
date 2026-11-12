// AID-1: ИИ-диалог по документу — doc-chat (предложение как diff) и doc-chat/apply (проверка версии).
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { lineDiff } from '@planar/module-ai/shared';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { doc, world, type World } from '../sync/helpers.js';

useApp();

let w: World;
let srv: http.Server;
let llmAnswer: { reply: string; body: string | null } = { reply: '', body: null };
let prompts: string[] = [];
const cookies: Record<string, string> = {};

beforeAll(async () => {
  process.env.PLANAR_SECRET_KEY = randomBytes(32).toString('base64');
  w = await world(db);
  cookies.admin = await loginCookie(db, w.admin.userId);
  cookies.member = await loginCookie(db, w.member.userId);
  cookies.guest = await loginCookie(db, w.guest.userId);
  cookies.root = await loginCookie(db, (await createUser(db, { role: 'admin' })).id);
  srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      prompts.push(raw);
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: 'c1',
          object: 'chat.completion',
          created: 1,
          model: 'fake',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: JSON.stringify(llmAnswer) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      );
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  await call('PUT', 'connections', 'root', {
    scope: 'instance',
    provider: 'openai-compatible',
    baseUrl: base,
    apiKey: 'sk-test',
    model: 'fake',
  });
});
afterAll(() => void srv.close());

const call = (method: string, url: string, who: string, body?: unknown) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: `/api/ai/${url}`,
      payload: body as object | undefined,
      headers: { cookie: cookies[who]!, origin: ORIGIN },
    });
const chat = (who: string, pageId: string, message = 'поправь') =>
  call('POST', 'doc-chat', who, { pageId, message });

async function mkPage(title: string, text: string, parentId?: string) {
  const id = uuidv7();
  await w.admin.ok('docs.page.create', {
    id,
    spaceId: w.spaceId,
    projectId: w.projectId,
    parentId,
    rank: id,
    title,
    body: doc(text),
  });
  return id;
}
const row = async (id: string) =>
  (
    await db.execute(
      sql`select to_json(updated_at) as "updatedAt", text from docs_pages where id = ${id}::uuid`,
    )
  ).rows[0] as { updatedAt: string; text: string };

describe('doc-chat', () => {
  it('lineDiff: same/add/del построчно', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'add', text: 'x' },
      { type: 'del', text: 'b' },
      { type: 'same', text: 'c' },
    ]);
  });

  it('предложение: ответ, diff и baseUpdatedAt; в документ ничего не пишется', async () => {
    const id = await mkPage('Заметка', 'Старый текст');
    const before = await row(id);
    llmAnswer = { reply: 'Заменил', body: 'Новый текст' };
    const r = await chat('admin', id);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      reply: 'Заменил',
      proposal: {
        body: 'Новый текст',
        baseUpdatedAt: before.updatedAt,
        diff: [
          { type: 'add', text: 'Новый текст' },
          { type: 'del', text: 'Старый текст' },
        ],
      },
    });
    expect((await row(id)).text).toBe(before.text);

    llmAnswer = { reply: 'Всё верно', body: null };
    expect((await chat('admin', id)).json()).toEqual({ reply: 'Всё верно', proposal: null });
    expect((await chat('admin', uuidv7())).statusCode).toBe(404);
    expect((await call('POST', 'doc-chat', 'admin', { pageId: id, message: '' })).statusCode).toBe(
      400,
    );
  });

  it('принятие пишет документ и версию; чужая правка → 409', async () => {
    const id = await mkPage('Принятие', 'Один');
    llmAnswer = { reply: 'ok', body: 'Два' };
    const p = (await chat('admin', id)).json().proposal;

    const a = await call('POST', 'doc-chat/apply', 'admin', {
      pageId: id,
      body: p.body,
      baseUpdatedAt: p.baseUpdatedAt,
    });
    expect(a.statusCode).toBe(200);
    const after = await row(id);
    expect(a.json()).toEqual({ ok: true, updatedAt: after.updatedAt });
    expect(after.text).toBe('Два');
    const v = await db.execute(
      sql`select count(*)::int as n from docs_versions where page_id = ${id}::uuid`,
    );
    expect((v.rows[0] as { n: number }).n).toBeGreaterThan(0);

    // тот же baseUpdatedAt после записи — страница уже изменена
    const again = await call('POST', 'doc-chat/apply', 'admin', {
      pageId: id,
      body: 'Три',
      baseUpdatedAt: p.baseUpdatedAt,
    });
    expect(again.statusCode).toBe(409);
    expect((await row(id)).text).toBe('Два');
  });

  it('403 без права записи', async () => {
    const id = await mkPage('Права', 'Текст');
    const { updatedAt } = await row(id);
    const r = await call('POST', 'doc-chat/apply', 'guest', {
      pageId: id,
      body: 'Взлом',
      baseUpdatedAt: updatedAt,
    });
    expect([403, 404]).toContain(r.statusCode);
    expect(r.statusCode).toBe(403);
    expect((await row(id)).text).toBe('Текст');
  });

  it('контекст пакета: статусы и правила только у страницы под «Harness-пакеты»', async () => {
    const container = await mkPage('Harness-пакеты', 'корень');
    const pack = await mkPage('Свой пакет', 'prompt', container);
    const plain = await mkPage('Обычная', 'prompt');
    llmAnswer = { reply: 'x', body: null };

    prompts = [];
    await chat('admin', plain);
    expect(prompts.join('')).not.toContain('Статусы проекта');

    prompts = [];
    await chat('admin', pack);
    const sent = prompts.join('');
    expect(sent).toContain('Статусы проекта');
    expect(sent).toContain('Правила проекта');
  });
});
