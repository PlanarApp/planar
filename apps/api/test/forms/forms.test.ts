import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { formsRateLimits } from '@planar/module-forms/api/schema';
import { createApp } from '../../src/app.js';
import { CoreService } from '../../src/core.service.js';
import * as s from '../../src/db/schema.js';
import { ORIGIN } from '../auth.js';
import { testDbUrl } from '../db.js';
import { newDb, world, type World } from '../sync/helpers.js';

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
let slug: string;
let fieldId: string;
const SLUG = () => Math.random().toString(36).slice(2).padEnd(16, 'a').slice(0, 16);

const inject = (method: 'GET' | 'POST', url: string, payload?: unknown, headers = {}) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url, payload: payload as object, headers });
const get = (sl = slug) => inject('GET', `/api/forms/public/${sl}`);
const post = (body: unknown, sl = slug) => inject('POST', `/api/forms/public/${sl}`, body);

function multipart(payload: unknown, files: { data: Buffer; field?: string }[]) {
  const b = '----t' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [
    Buffer.from(
      `--${b}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n`,
    ),
  ];
  for (const f of files)
    parts.push(
      Buffer.from(
        `--${b}\r\nContent-Disposition: form-data; name="${f.field ?? 'file'}"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\n`,
      ),
      f.data,
      Buffer.from('\r\n'),
    );
  parts.push(Buffer.from(`--${b}--\r\n`));
  return post_raw(Buffer.concat(parts), `multipart/form-data; boundary=${b}`);
}
const post_raw = (payload: Buffer, type: string) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: `/api/forms/public/${slug}`,
      payload,
      headers: { 'content-type': type },
    });

const fields = (extra: object[] = []) => [
  { key: 'title', label: 'Тема', required: true },
  { key: 'description', label: 'Описание', required: false },
  { key: 'email', label: 'Email', required: true },
  ...extra,
];
const tasksOf = () => db.select().from(s.tasks).where(eq(s.tasks.projectId, w.projectId));
const setEnabled = (ids: string[]) =>
  db
    .insert(s.settings)
    .values({ id: 'enabled_modules', value: ids })
    .onConflictDoUpdate({ target: s.settings.id, set: { value: ids } });
const mkForm = async (over: Record<string, unknown> = {}) => {
  const id = uuidv7();
  const sl = SLUG();
  await w.admin.ok('forms.create', {
    id,
    projectId: w.projectId,
    slug: sl,
    title: 'Обратная связь',
    statusId: w.statusIds[2],
    fields: fields([
      { key: `field:${fieldId}`, label: 'Версия', required: false },
      { key: 'files', label: 'Файлы', required: false },
    ]),
    ...over,
  });
  return { id, slug: sl };
};

beforeAll(async () => {
  process.env.MAX_UPLOAD_MB = '1';
  w = await world(db);
  await setEnabled(['forms']);
  fieldId = uuidv7();
  await w.admin.ok('field.create', {
    id: fieldId,
    projectId: w.projectId,
    name: 'Версия',
    type: 'text',
    rank: 'a0',
  });
  app = await createApp({
    databaseUrl: testDbUrl(),
    publicUrl: ORIGIN,
    dataDir: mkdtempSync(join(tmpdir(), 'planar-forms-')),
    maxUploadMb: 1,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  slug = (await mkForm()).slug;
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});
beforeEach(async () => {
  await db.delete(formsRateLimits);
});

describe('pt5a: публичный эндпоинт', () => {
  it('pt5a: GET схемы без cookie', async () => {
    const r = await get();
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.title).toBe('Обратная связь');
    expect(j.fields.map((f: { key: string; type: string }) => [f.key, f.type])).toEqual([
      ['title', 'text'],
      ['description', 'longtext'],
      ['email', 'email'],
      [`field:${fieldId}`, 'text'],
      ['files', 'files'],
    ]);
  });

  it('pt5a: POST создаёт задачу от «Форма» со статусом формы, полем и отправителем', async () => {
    const r = await post({
      values: {
        title: 'Сломалось',
        description: 'Строка 1\nСтрока 2',
        email: 'a@b.ru',
        [`field:${fieldId}`]: '1.2',
      },
      website: '',
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ ok: true });
    const t = (await tasksOf()).find((x) => x.title === 'Сломалось')!;
    expect(t.statusId).toBe(w.statusIds[2]);
    expect(t.fields).toEqual({ [fieldId]: '1.2' });
    const [u] = await db.select().from(s.users).where(eq(s.users.id, t.createdBy));
    expect(u).toMatchObject({ login: 'form', name: 'Форма' });
    expect(u!.deactivatedAt).not.toBeNull();
    const text = (t.description as { content: { content: { text: string }[] }[] }).content.map(
      (p) => p.content[0]!.text,
    );
    expect(text).toEqual(['Строка 1', 'Строка 2', 'Отправитель: a@b.ru']);
  });

  it('pt5a: пустое обязательное поле → 400', async () => {
    expect((await post({ values: { title: 'x', email: '' }, website: '' })).statusCode).toBe(400);
    expect((await post({ values: { email: 'a@b.ru' }, website: '' })).statusCode).toBe(400);
  });

  it('pt5a: лишний ключ → 400', async () => {
    const r = await post({ values: { title: 'x', email: 'a@b.ru', evil: 1 }, website: '' });
    expect(r.statusCode).toBe(400);
  });

  it('pt5a: title длиннее 500 → 400; неверный email → 400', async () => {
    expect(
      (await post({ values: { title: 'x'.repeat(501), email: 'a@b.ru' }, website: '' })).statusCode,
    ).toBe(400);
    expect(
      (await post({ values: { title: 'x', email: 'не-почта' }, website: '' })).statusCode,
    ).toBe(400);
  });

  it('pt5a: тело больше 64 КБ → 413', async () => {
    const r = await post({
      values: { title: 'x', email: 'a@b.ru', description: 'y'.repeat(70000) },
      website: '',
    });
    expect(r.statusCode).toBe(413);
  });

  it('pt5a: honeypot → 201 без задачи', async () => {
    const before = (await tasksOf()).length;
    const r = await post({ values: { title: 'спам', email: 'a@b.ru' }, website: 'http://spam' });
    expect(r.statusCode).toBe(201);
    expect((await tasksOf()).length).toBe(before);
  });

  it('pt5a: 6-я отправка за минуту → 429', async () => {
    const ok = { values: { title: 'r', email: 'a@b.ru' }, website: '' };
    for (let i = 0; i < 5; i++) expect((await post(ok)).statusCode).toBe(201);
    const r = await post(ok);
    expect(r.statusCode).toBe(429);
    expect(r.json().code).toBe('rate_limited');
  });

  it('pt5a: часовой лимит 30 → 429', async () => {
    const ok = { values: { title: 'h', email: 'a@b.ru' }, website: 'hp' };
    await db.insert(formsRateLimits).values({
      key: '127.0.0.1|h',
      count: 30,
      windowStartedAt: new Date().toISOString(),
    });
    expect((await post(ok)).statusCode).toBe(429);
  });

  it('pt5a: нет формы, выключена, архивный проект, модуль выключен → одинаковый 404', async () => {
    const off = await mkForm();
    await w.admin.ok('forms.update', { id: off.id, enabled: false });
    const bodies = [
      await get('0000000000000000'),
      await get(off.slug),
      await post({ values: { title: 'x', email: 'a@b.ru' }, website: '' }, off.slug),
    ];
    for (const r of bodies) expect(r.statusCode).toBe(404);
    expect(new Set(bodies.map((r) => r.body)).size).toBe(1);
    const arch = await mkForm();
    await db
      .update(s.projects)
      .set({ archivedAt: new Date().toISOString() })
      .where(eq(s.projects.id, w.projectId));
    expect((await get(arch.slug)).statusCode).toBe(404);
    await db.update(s.projects).set({ archivedAt: null }).where(eq(s.projects.id, w.projectId));
    await setEnabled([]);
    expect((await get()).statusCode).toBe(404);
    await setEnabled(['forms']);
    expect((await get()).statusCode).toBe(200);
  });

  it('pt5a: вложения multipart → attachments задачи', async () => {
    const r = await multipart({ values: { title: 'С файлами', email: 'a@b.ru' }, website: '' }, [
      { data: Buffer.from('один') },
      { data: Buffer.from('два') },
    ]);
    expect(r.statusCode).toBe(201);
    const t = (await tasksOf()).find((x) => x.title === 'С файлами')!;
    const at = await db.select().from(s.attachments).where(eq(s.attachments.taskId, t.id));
    expect(at).toHaveLength(2);
    expect(at[0]!.uploadedBy).toBe(t.createdBy);
  });

  it('pt5a: больше 3 файлов → 400, больше лимита → 413, форма без files → 400', async () => {
    const p = { values: { title: 'f', email: 'a@b.ru' }, website: '' };
    const f = { data: Buffer.from('x') };
    expect((await multipart(p, [f, f, f, f])).statusCode).toBe(400);
    expect((await multipart(p, [{ data: Buffer.alloc(1024 * 1024 + 10, 1) }])).statusCode).toBe(
      413,
    );
    const plain = await mkForm({ fields: fields() });
    const prev = slug;
    slug = plain.slug;
    expect((await multipart(p, [f])).statusCode).toBe(400);
    slug = prev;
  });
});

describe('pt5a: сущность formsForms', () => {
  it('pt5a: не-админ пространства не может forms.create', async () => {
    const r = await w.member.push('forms.create', {
      id: uuidv7(),
      projectId: w.projectId,
      slug: SLUG(),
      title: 'x',
      statusId: w.statusIds[0],
      fields: fields(),
    });
    expect(JSON.stringify(r)).toContain('forbidden');
  });

  it('pt5a: дубль slug → conflict; статус чужого пространства → invalid_args', async () => {
    const r = await w.admin.push('forms.create', {
      id: uuidv7(),
      projectId: w.projectId,
      slug,
      title: 'x',
      statusId: w.statusIds[0],
      fields: fields(),
    });
    expect(JSON.stringify(r)).toContain('conflict');
    const other = await world(db);
    const r2 = await w.admin.push('forms.create', {
      id: uuidv7(),
      projectId: w.projectId,
      slug: SLUG(),
      title: 'x',
      statusId: other.statusIds[0],
      fields: fields(),
    });
    expect(JSON.stringify(r2)).toContain('invalid_args');
  });

  it('pt5a: fields без обязательного title → invalid_args', async () => {
    const r = await w.admin.push('forms.create', {
      id: uuidv7(),
      projectId: w.projectId,
      slug: SLUG(),
      title: 'x',
      statusId: w.statusIds[0],
      fields: [{ key: 'email', label: 'e', required: true }],
    });
    expect(JSON.stringify(r)).toContain('invalid_args');
  });
});

describe('pt5a: CoreServices v9', () => {
  const core = () => app.get(CoreService);

  it('pt5a: ensureSystemUser идемпотентен; «Автоматизация» не сломана', async () => {
    const a = await core().ensureSystemUser('pt5a-bot', 'Бот');
    expect(await core().ensureSystemUser('pt5a-bot', 'Другое имя')).toBe(a);
    const [u] = await db.select().from(s.users).where(eq(s.users.id, a));
    expect(u).toMatchObject({ name: 'Бот', passwordHash: '!' });
    expect(core().systemUserId()).toBe(
      (await db.select().from(s.users).where(eq(s.users.login, 'automation')))[0]!.id,
    );
  });

  it('pt5a: execute — мутации одной транзакцией, system обходит права', async () => {
    const bot = await core().ensureSystemUser('pt5a-bot', 'Бот');
    const id = uuidv7();
    await core().execute(
      bot,
      [
        {
          name: 'task.create',
          args: { id, projectId: w.projectId, statusId: w.statusIds[0], title: 'E', rank: 'a1' },
        },
      ],
      { system: true },
    );
    expect((await tasksOf()).some((t) => t.id === id)).toBe(true);
    await expect(
      core().execute(bot, [
        {
          name: 'task.create',
          args: {
            id: uuidv7(),
            projectId: w.projectId,
            statusId: w.statusIds[0],
            title: 'N',
            rank: 'a2',
          },
        },
      ]),
    ).rejects.toThrow();
  });

  it('pt5a: storeFile пишет файл и files/file_uploads; больше лимита → 413', async () => {
    const bot = await core().ensureSystemUser('pt5a-bot', 'Бот');
    const r = await core().storeFile(Buffer.from('содержимое'), bot, 'text/plain');
    expect(r).toMatchObject({ size: 20, mime: 'text/plain', width: null, height: null });
    expect(
      await db.select().from(s.fileUploads).where(eq(s.fileUploads.sha256, r.sha256)),
    ).toHaveLength(1);
    await expect(core().storeFile(Buffer.alloc(1024 * 1024 + 1), bot)).rejects.toMatchObject({
      status: 413,
    });
  });
});
