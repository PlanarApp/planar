import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { formsLinks, formsRateLimits } from '@planar/module-forms/api/schema';
import { createApp } from '../../src/app.js';
import * as s from '../../src/db/schema.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { testDbUrl } from '../db.js';
import { newDb, taskArgs, world, type World } from '../sync/helpers.js';

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
let formId: string;
let slug: string;
let taskId: string;
let taskKey: string;

const inject = (method: 'GET' | 'POST', url: string, payload?: unknown, headers = {}) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url, payload: payload as object, headers });
const issue = async (body: Record<string, unknown> = {}, who = w.admin.userId) =>
  inject(
    'POST',
    '/api/forms/links',
    { formId, task: taskKey, ...body },
    { cookie: await loginCookie(db, who), origin: ORIGIN },
  );
const mint = async (body: Record<string, unknown> = {}) => {
  const r = await issue(body);
  expect(r.statusCode).toBe(201);
  return r.json() as { token: string; path: string; expiresAt: string };
};
const pub = (method: 'GET' | 'POST', t: string, sl = slug) =>
  inject(
    method,
    `/api/forms/public/${sl}?t=${t}`,
    method === 'POST' ? { values: { title: 'Ответ', email: 'a@b.ru' }, website: '' } : undefined,
  );
const commentsOf = () => db.select().from(s.comments).where(eq(s.comments.taskId, taskId));

beforeAll(async () => {
  w = await world(db);
  await db
    .update(s.projects)
    .set({ modules: ['forms'] })
    .where(eq(s.projects.id, w.projectId));
  app = await createApp({
    databaseUrl: testDbUrl(),
    publicUrl: ORIGIN,
    dataDir: mkdtempSync(join(tmpdir(), 'planar-forms-link-')),
    maxUploadMb: 1,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  formId = uuidv7();
  slug = Math.random().toString(36).slice(2).padEnd(16, 'a').slice(0, 16);
  await w.admin.ok('forms.create', {
    id: formId,
    projectId: w.projectId,
    slug,
    title: 'Анкета',
    statusId: w.statusIds[2],
    fields: [
      { key: 'title', label: 'Тема', required: true },
      { key: 'email', label: 'Email', required: true },
    ],
  });
  const a = taskArgs(w);
  await w.admin.ok('task.create', a);
  taskId = a.id;
  const [t] = await db.select().from(s.tasks).where(eq(s.tasks.id, taskId));
  const [p] = await db.select().from(s.projects).where(eq(s.projects.id, w.projectId));
  taskKey = `${p!.key}-${t!.number}`;
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});
beforeEach(async () => {
  await db.delete(formsRateLimits);
});

describe('PLNRAPP-173: персональная ссылка «ответ к задаче»', () => {
  it('токен отдаётся один раз, в БД только хеш', async () => {
    const l = await mint();
    expect(l.path).toBe(`/f/${slug}?t=${l.token}`);
    const rows = await db.select().from(formsLinks).where(eq(formsLinks.formId, formId));
    expect(rows.some((r) => r.tokenHash === l.token)).toBe(false);
    expect(rows.some((r) => JSON.stringify(r).includes(l.token))).toBe(false);
  });

  it('GET по ссылке: схема с reply, без токена — без reply', async () => {
    const l = await mint();
    expect((await pub('GET', l.token)).json().reply).toBe(true);
    expect((await inject('GET', `/api/forms/public/${slug}`)).json().reply).toBeUndefined();
  });

  it('POST пишет комментарий от «Форма» в задачу, новых задач нет', async () => {
    const l = await mint();
    const before = (await db.select().from(s.tasks).where(eq(s.tasks.projectId, w.projectId)))
      .length;
    const r = await pub('POST', l.token);
    expect(r.statusCode).toBe(201);
    const [c] = await commentsOf();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, c!.authorId));
    expect(u!.login).toBe('form');
    expect(JSON.stringify(c!.body)).toContain('Тема: Ответ');
    expect(JSON.stringify(c!.body)).toContain('Email: a@b.ru');
    expect((await db.select().from(s.tasks).where(eq(s.tasks.projectId, w.projectId))).length).toBe(
      before,
    );
  });

  it('одноразовая: повтор → 404; многоразовая принимает повторно', async () => {
    const once = await mint();
    expect((await pub('POST', once.token)).statusCode).toBe(201);
    expect((await pub('POST', once.token)).statusCode).toBe(404);
    expect((await pub('GET', once.token)).statusCode).toBe(404);
    const many = await mint({ singleUse: false });
    expect((await pub('POST', many.token)).statusCode).toBe(201);
    expect((await pub('POST', many.token)).statusCode).toBe(201);
  });

  it('срок: просроченная ссылка → 404', async () => {
    const l = await mint({ singleUse: false });
    await db
      .update(formsLinks)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(formsLinks.formId, formId));
    expect((await pub('GET', l.token)).statusCode).toBe(404);
    expect((await pub('POST', l.token)).statusCode).toBe(404);
    await db.delete(formsLinks).where(eq(formsLinks.formId, formId));
  });

  it('неверный токен и токен чужой формы → 404', async () => {
    expect((await pub('POST', 'x'.repeat(43))).statusCode).toBe(404);
    const l = await mint();
    const other = uuidv7();
    const otherSlug = 'zzzzzzzzzzzzzzzz';
    await w.admin.ok('forms.create', {
      id: other,
      projectId: w.projectId,
      slug: otherSlug,
      title: 'Другая',
      statusId: w.statusIds[2],
      fields: [{ key: 'title', label: 'Тема', required: true }],
    });
    expect((await pub('POST', l.token, otherSlug)).statusCode).toBe(404);
    expect((await pub('POST', l.token)).statusCode).toBe(201);
  });

  it('невалидный ответ не сжигает одноразовую ссылку', async () => {
    const l = await mint();
    const bad = await inject('POST', `/api/forms/public/${slug}?t=${l.token}`, {
      values: { title: 'x' },
      website: '',
    });
    expect(bad.statusCode).toBe(400);
    expect((await pub('POST', l.token)).statusCode).toBe(201);
  });

  it('тот же лимит частоты: 6-я отправка → 429', async () => {
    const l = await mint({ singleUse: false });
    for (let i = 0; i < 5; i++) expect((await pub('POST', l.token)).statusCode).toBe(201);
    expect((await pub('POST', l.token)).statusCode).toBe(429);
  });

  it('выдача: не админ → 403, без входа → 401, чужая задача → 404', async () => {
    expect((await issue({}, w.member.userId)).statusCode).toBe(403);
    expect((await inject('POST', '/api/forms/links', { formId, task: taskKey })).statusCode).toBe(
      401,
    );
    expect((await issue({ task: 'NOPE-999' })).statusCode).toBe(404);
    expect((await issue({ ttlHours: 0 })).statusCode).toBe(400);
  });
});
