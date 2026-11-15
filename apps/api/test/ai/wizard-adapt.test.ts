// Шаг мастера «Адаптировать с помощью ИИ»: wizard/adapt (предложение как diff) и wizard/adapt/apply (проверка версии).
// Только страницы harness-пакета: «Разговор с документом» для любой страницы убран (PLNRAPP-209).
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
    scope: 'workspace',
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
  call('POST', 'wizard/adapt', who, { pageId, message });

let packs = '';
async function mkPage(title: string, text: string, parentId?: string | null) {
  if (parentId === undefined) {
    packs ||= await mkPage('Harness-пакеты', 'корень', null);
    parentId = packs;
  }
  const id = uuidv7();
  await w.admin.ok('docs.page.create', {
    id,
    spaceId: w.spaceId,
    projectId: w.projectId,
    parentId: parentId ?? undefined,
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

describe('wizard/adapt', () => {
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
    expect(
      (await call('POST', 'wizard/adapt', 'admin', { pageId: id, message: '' })).statusCode,
    ).toBe(400);
  });

  it('принятие пишет документ и версию; чужая правка → 409', async () => {
    const id = await mkPage('Принятие', 'Один');
    llmAnswer = { reply: 'ok', body: 'Два' };
    const p = (await chat('admin', id)).json().proposal;

    const a = await call('POST', 'wizard/adapt/apply', 'admin', {
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
    const again = await call('POST', 'wizard/adapt/apply', 'admin', {
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
    const r = await call('POST', 'wizard/adapt/apply', 'guest', {
      pageId: id,
      body: 'Взлом',
      baseUpdatedAt: updatedAt,
    });
    expect([403, 404]).toContain(r.statusCode);
    expect(r.statusCode).toBe(403);
    expect((await row(id)).text).toBe('Текст');
  });

  it('обычная страница — 409 и в предложении, и в принятии; ИИ не вызывается', async () => {
    const plain = await mkPage('Обычная', 'prompt', null);
    llmAnswer = { reply: 'x', body: 'Новый' };
    prompts = [];
    expect((await chat('admin', plain)).statusCode).toBe(409);
    expect(prompts).toEqual([]);
    const { updatedAt } = await row(plain);
    const a = await call('POST', 'wizard/adapt/apply', 'admin', {
      pageId: plain,
      body: 'Новый',
      baseUpdatedAt: updatedAt,
    });
    expect(a.statusCode).toBe(409);
    expect((await row(plain)).text).toBe('prompt');
  });

  it('контекст пакета: статусы и правила проекта', async () => {
    const pack = await mkPage('Свой пакет', 'prompt');
    llmAnswer = { reply: 'x', body: null };
    prompts = [];
    await chat('admin', pack);
    const sent = prompts.join('');
    expect(sent).toContain('Статусы проекта');
    expect(sent).toContain('Правила проекта');
  });
});

describe('wizard/adapt: защита (AIX-3)', () => {
  it('гость — 403, модуль ИИ выключен — 409, выключатель — 409; ничего не вызывается', async () => {
    const id = await mkPage('Защита', 'Текст');
    llmAnswer = { reply: 'x', body: null };
    prompts = [];
    expect((await chat('guest', id)).statusCode).toBe(403);

    await db.execute(
      sql`update projects set modules = array_remove(modules, 'ai') where id = ${w.projectId}::uuid`,
    );
    const noModule = await chat('admin', id);
    await db.execute(
      sql`update projects set modules = array_append(modules, 'ai') where id = ${w.projectId}::uuid`,
    );
    expect(noModule.statusCode).toBe(409);

    await db.execute(
      sql`insert into ai_settings (id, enabled) values (1, false) on conflict (id) do update set enabled = false`,
    );
    const off = await chat('admin', id);
    await db.execute(sql`update ai_settings set enabled = true where id = 1`);
    expect(off.statusCode).toBe(409);
    expect(prompts).toEqual([]);
  });

  it('расход пишется строкой ai_runs kind chat и попадает в суточный лимит', async () => {
    const id = await mkPage('Расход', 'Текст');
    llmAnswer = { reply: 'x', body: null };
    const n = async () =>
      (
        await db.execute(
          sql`select coalesce(sum(input_tokens + output_tokens), 0)::int as t, count(*)::int as c
              from ai_runs where project_id = ${w.projectId}::uuid and kind = 'chat' and channel_id is null`,
        )
      ).rows[0] as { t: number; c: number };
    const before = await n();
    expect((await chat('admin', id)).statusCode).toBe(200);
    const after = await n();
    expect(after.c).toBe(before.c + 1);
    expect(after.t).toBe(before.t + 20);

    await db.execute(
      sql`insert into ai_project_limits (project_id, daily_tokens) values (${w.projectId}::uuid, 1)
          on conflict (project_id) do update set daily_tokens = 1`,
    );
    const r = await chat('admin', id);
    await db.execute(sql`delete from ai_project_limits where project_id = ${w.projectId}::uuid`);
    expect(r.statusCode).toBe(409);
  });

  it('страница с упоминанием — 409 и в предложении, и в принятии', async () => {
    const id = await mkPage('Упоминание', 'Текст');
    await db.execute(
      sql`update docs_pages set body = ${JSON.stringify({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'mention', attrs: { id: w.admin.userId } }] },
        ],
      })}::jsonb where id = ${id}::uuid`,
    );
    llmAnswer = { reply: 'x', body: 'Новый' };
    expect((await chat('admin', id)).statusCode).toBe(409);
    const { updatedAt } = await row(id);
    const a = await call('POST', 'wizard/adapt/apply', 'admin', {
      pageId: id,
      body: 'Новый',
      baseUpdatedAt: updatedAt,
    });
    expect(a.statusCode).toBe(409);
  });
});
