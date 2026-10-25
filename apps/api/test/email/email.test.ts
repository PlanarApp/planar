import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { digestTick, notifyTick } from '@planar/module-email/api';
import {
  emailConfig as C,
  emailDigests as D,
  emailOutbox as O,
} from '@planar/module-email/api/schema';
import { decrypt } from '../../../../modules/email/api/crypto.js';
import { parseUnsub, unsubToken } from '../../../../modules/email/api/mail.js';
import { notifications, settings, tasks, users } from '../../src/db/schema.js';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { taskArgs, world, type World } from '../sync/helpers.js';
import { decoded, smtpStub } from './smtp-stub.js';

useApp();

const KEY = randomBytes(32).toString('base64');
const PASSWORD = 'smtp-SECRET-pass';
const T0 = new Date('2026-10-25T10:00:00.000Z');
const min = (n: number) => new Date(+T0 + n * 60_000);
let w: World;
let cookie: string;
let stub: Awaited<ReturnType<typeof smtpStub>>;
let rcpt: { id: string };
let actor: { id: string };
let taskId: string;
let taskKey: string;

const call = (
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = { cookie, origin: ORIGIN },
) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({ method: method as 'GET', url, payload: body as object | undefined, headers });
const setup = (method: string, p: string, body?: unknown, h?: Record<string, string>) =>
  call(method, `/api/email/setup/${p}`, body, h);
const configure = () =>
  setup('PUT', 'config', {
    host: '127.0.0.1',
    port: stub.port,
    secure: false,
    from: 'Planar <planar@example.test>',
    password: PASSWORD,
  });
const notif = async (over: Partial<typeof notifications.$inferInsert> = {}) => {
  const id = uuidv7();
  await db.insert(notifications).values({
    id,
    userId: rcpt.id,
    spaceId: w.spaceId,
    kind: 'mentioned',
    taskId,
    actorId: actor.id,
    createdAt: min(-30).toISOString(),
    ...over,
  });
  return id;
};
const outbox = () => db.select().from(O);
const setPrefs = (id: string, args: object) =>
  db.execute(
    sql`insert into email_prefs (id, user_id, notify, digest, updated_at) values (${id}, ${id}, ${(args as { notify?: boolean }).notify ?? true}, ${(args as { digest?: boolean }).digest ?? false}, now())
      on conflict (id) do update set notify = excluded.notify, digest = excluded.digest`,
  );

beforeAll(async () => {
  process.env.PLANAR_SECRET_KEY = KEY;
  await db.insert(settings).values({ id: 'enabled_modules', value: ['email'] });
  stub = await smtpStub();
  w = await world(db);
  cookie = await loginCookie(db, (await createUser(db, { role: 'admin' })).id);
  rcpt = await createUser(db, { name: 'Рита' });
  actor = await createUser(db, { name: 'Антон <b>' });
  await db.update(users).set({ email: 'rita@example.test' }).where(eq(users.id, rcpt.id));
  taskId = uuidv7();
  await w.admin.ok('task.create', taskArgs(w, { id: taskId, title: 'Задача <script>x</script>' }));
  const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  const [p] = (await db.$client.query('select key from projects where id = $1', [t!.projectId]))
    .rows;
  taskKey = `${p.key}-${t!.number}`;
});
afterAll(() => stub.close());
beforeEach(async () => {
  process.env.PLANAR_SECRET_KEY = KEY;
  stub.mails.length = 0;
  stub.failRcpt = false;
  await db.delete(O);
  await db.delete(D);
  await db.delete(notifications);
  await db.execute(sql`delete from email_prefs`);
  await db.delete(settings).where(eq(settings.id, 'timezone'));
  await db.delete(C);
  expect((await configure()).statusCode).toBe(200);
});

describe('pf4: настройки SMTP', () => {
  it('pf4: пароль шифруется AES-256-GCM, ответы без пароля', async () => {
    const [c] = await db.select().from(C);
    expect(c!.passwordEnc).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(c!.passwordEnc).not.toContain(PASSWORD);
    expect(decrypt(c!.passwordEnc!, Buffer.from(KEY, 'base64'))).toBe(PASSWORD);
    const r = await setup('GET', 'config');
    expect(r.body).not.toContain(PASSWORD);
    expect(r.json()).toMatchObject({
      host: '127.0.0.1',
      hasPassword: true,
      configured: true,
      from: 'Planar <planar@example.test>',
    });
    expect((await setup('PUT', 'config', { password: null })).json().hasPassword).toBe(false);
  });

  it('pf4: без PLANAR_SECRET_KEY пароль → 503, письма не уходят', async () => {
    delete process.env.PLANAR_SECRET_KEY;
    expect((await setup('PUT', 'config', { password: 'x' })).statusCode).toBe(503);
    await notif();
    expect(await notifyTick(db, T0)).toBe(0);
    expect(stub.mails).toHaveLength(0);
  });

  it('pf4: доступ только owner/admin сессией', async () => {
    const m = await loginCookie(db, rcpt.id);
    expect((await setup('GET', 'config', undefined, { cookie: m })).statusCode).toBe(403);
    expect((await setup('GET', 'config', undefined, { cookie: '' })).statusCode).toBe(401);
  });

  it('pf4: неверный from (CRLF, два адреса) и порт → 400', async () => {
    for (const body of [
      { from: 'a@b.test\r\nBcc: x@y.test' },
      { from: 'a@b.test, c@d.test' },
      { from: 'не адрес' },
      { port: 70000 },
    ])
      expect((await setup('PUT', 'config', body)).statusCode).toBe(400);
  });

  it('pf4: тестовое письмо доходит; ошибка SMTP → 502 без пароля', async () => {
    const ok = await setup('POST', 'test', { to: 'admin@example.test' });
    expect(ok.json()).toEqual({ ok: true });
    expect(stub.mails).toHaveLength(1);
    expect(stub.mails[0]!.rcpt[0]).toContain('admin@example.test');
    stub.failRcpt = true;
    const bad = await setup('POST', 'test', { to: 'admin@example.test' });
    expect(bad.statusCode).toBe(502);
    expect(bad.json().code).toBe('unavailable');
    expect(bad.body).not.toContain(PASSWORD);
  });
});

describe('pf4: письма по уведомлениям', () => {
  it('pf4: не раньше 10 минут, ровно через 10 — отправляется', async () => {
    const id = await notif({ createdAt: min(-9).toISOString() });
    expect(await notifyTick(db, T0)).toBe(0);
    expect(await outbox()).toHaveLength(0);
    expect(await notifyTick(db, min(1))).toBe(1);
    expect((await outbox())[0]).toMatchObject({ notificationId: id, status: 'sent' });
  });

  it('pf4: старше 24 часов не отправляется', async () => {
    await notif({ createdAt: new Date(+T0 - 25 * 3600_000).toISOString() });
    expect(await notifyTick(db, T0)).toBe(0);
  });

  it('pf4: прочитанное не отправляется', async () => {
    await notif({ readAt: min(-5).toISOString() });
    expect(await notifyTick(db, T0)).toBe(0);
    expect(stub.mails).toHaveLength(0);
  });

  it('pf4: два тика подряд и параллельно — одно письмо', async () => {
    await notif();
    await Promise.all([notifyTick(db, T0), notifyTick(db, T0)]);
    await notifyTick(db, min(1));
    expect(stub.mails).toHaveLength(1);
    expect(await outbox()).toHaveLength(1);
  });

  it('pf4: notify=false, без email и деактивированный — без письма', async () => {
    await notif();
    await setPrefs(rcpt.id, { notify: false });
    expect(await notifyTick(db, T0)).toBe(0);
    await setPrefs(rcpt.id, { notify: true });
    await db.update(users).set({ email: null }).where(eq(users.id, rcpt.id));
    expect(await notifyTick(db, T0)).toBe(0);
    await db
      .update(users)
      .set({ email: 'rita@example.test', deactivatedAt: T0.toISOString() })
      .where(eq(users.id, rcpt.id));
    expect(await notifyTick(db, T0)).toBe(0);
    await db.update(users).set({ deactivatedAt: null }).where(eq(users.id, rcpt.id));
    expect(await notifyTick(db, T0)).toBe(1);
  });

  it('pf4: kind commented не отправляется; chat_mention — да', async () => {
    await notif({ kind: 'commented' });
    expect(await notifyTick(db, T0)).toBe(0);
    await notif({ kind: 'chat_mention', taskId: null, url: '/m/chat/x', body: 'привет' });
    expect(await notifyTick(db, T0)).toBe(1);
    expect(decoded(stub.mails[0]!.data)).toContain('/m/chat/x');
  });

  it('pf4: заголовки отписки, ссылка на задачу, HTML экранирован', async () => {
    await notif();
    await notifyTick(db, T0);
    const raw = decoded(stub.mails[0]!.data);
    expect(raw).toMatch(
      /List-Unsubscribe:\s+<http:\/\/localhost:5173\/api\/email\/unsubscribe\?t=/i,
    );
    expect(raw).toMatch(/List-Unsubscribe-Post: List-Unsubscribe=One-Click/i);
    expect(raw).toContain(`/t/${taskKey}`);
    expect(raw.split('text/html')[1]).not.toContain('<script>');
    expect(raw).not.toContain(PASSWORD);
  });

  it('pf4: ошибка SMTP → failed с текстом, повтора нет', async () => {
    const id = await notif();
    stub.failRcpt = true;
    expect(await notifyTick(db, T0)).toBe(0);
    const [r] = await outbox();
    expect(r).toMatchObject({ notificationId: id, status: 'failed' });
    expect(r!.error).toBeTruthy();
    expect(r!.error).not.toContain(PASSWORD);
    stub.failRcpt = false;
    expect(await notifyTick(db, min(5))).toBe(0);
    expect(stub.mails).toHaveLength(0);
  });
});

describe('pf4: дайджест', () => {
  beforeEach(() => setPrefs(rcpt.id, { digest: true }));

  it('pf4: раз в день после 8:00 в поясе; до 8:00 и без digest — нет', async () => {
    await notif();
    expect(await digestTick(db, new Date('2026-10-25T07:00:00Z'))).toBe(0);
    expect(await digestTick(db, new Date('2026-10-25T09:00:00Z'))).toBe(1);
    expect(await digestTick(db, new Date('2026-10-25T15:00:00Z'))).toBe(0);
    expect(await digestTick(db, new Date('2026-10-26T09:00:00Z'))).toBe(1);
    expect(stub.mails).toHaveLength(2);
    expect(decoded(stub.mails[0]!.data)).toContain('Дайджест');
  });

  it('pf4: пояс из settings.timezone', async () => {
    await notif();
    await db.insert(settings).values({ id: 'timezone', value: 'Asia/Tokyo' });
    // 20:00 UTC = 05:00 в Токио
    expect(await digestTick(db, new Date('2026-10-25T20:00:00Z'))).toBe(0);
    expect(await digestTick(db, new Date('2026-10-25T23:30:00Z'))).toBe(1);
  });

  it('pf4: нечего слать — skipped без письма; просроченная задача исполнителя попадает', async () => {
    expect(await digestTick(db, new Date('2026-10-25T09:00:00Z'))).toBe(0);
    expect((await db.select().from(D))[0]).toMatchObject({ status: 'skipped' });
    await db.delete(D);
    await db.update(tasks).set({ dueDate: '2026-10-20' }).where(eq(tasks.id, taskId));
    await db.execute(
      sql`insert into task_assignees (id, space_id, task_id, user_id) values (${uuidv7()}, ${w.spaceId}, ${taskId}, ${rcpt.id}) on conflict do nothing`,
    );
    expect(await digestTick(db, new Date('2026-10-25T09:00:00Z'))).toBe(1);
    expect(decoded(stub.mails[0]!.data)).toContain(taskKey);
    // архивный проект — задача не попадает
    await db.delete(D);
    stub.mails.length = 0;
    await db.execute(sql`update projects set archived_at = now() where id = ${w.projectId}`);
    await digestTick(db, new Date('2026-10-25T09:00:00Z'));
    expect(stub.mails).toHaveLength(0);
    await db.execute(sql`update projects set archived_at = null where id = ${w.projectId}`);
    await db.execute(sql`delete from task_assignees where task_id = ${taskId}`);
  });
});

describe('pf4: отписка', () => {
  const key = () => Buffer.from(KEY, 'base64');
  const tok = (kind: 'notify' | 'digest' = 'notify') => unsubToken(key(), rcpt.id, kind);
  const prefs = async () =>
    (await db.execute(sql`select notify, digest from email_prefs where id = ${rcpt.id}`)).rows[0];
  const anon = { origin: ORIGIN };

  it('pf4: токен: подпись проверяется, чужая и подделанная — null', () => {
    expect(parseUnsub(key(), tok())).toEqual({ userId: rcpt.id, kind: 'notify' });
    expect(
      parseUnsub(
        key(),
        tok().replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')),
      ),
    ).toBeNull();
    expect(parseUnsub(key(), tok().replace('.notify.', '.digest.'))).toBeNull();
    expect(parseUnsub(randomBytes(32), tok())).toBeNull();
    expect(parseUnsub(key(), 'мусор')).toBeNull();
  });

  it('pf4: GET без входа — страница с формой, POST отписывает; неверный токен → 400', async () => {
    const g = await call('GET', `/api/email/unsubscribe?t=${tok()}`, undefined, {});
    expect(g.statusCode).toBe(200);
    expect(g.headers['content-type']).toContain('text/html');
    expect(g.body).toContain('<form method="post"');
    expect(await prefs()).toBeUndefined();
    const p = await call('POST', `/api/email/unsubscribe?t=${tok()}`, 'x=1', {
      ...anon,
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(p.statusCode).toBe(200);
    expect(p.body).toContain('отписаны');
    expect(await prefs()).toMatchObject({ notify: false, digest: false });
    for (const m of ['GET', 'POST'])
      expect((await call(m, `/api/email/unsubscribe?t=${tok()}x`, undefined, {})).statusCode).toBe(
        400,
      );
    expect((await call('GET', '/api/email/unsubscribe', undefined, {})).statusCode).toBe(400);
  });

  it('pf4: form-urlencoded на другой маршрут /api/* — 415 как до модуля', async () => {
    const r = await call('POST', '/api/email/setup/test', 'to=a', {
      cookie,
      origin: ORIGIN,
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(r.statusCode).toBe(415);
  });

  it('pf4: RFC 8058 One-Click: digest отписывает только digest', async () => {
    await setPrefs(rcpt.id, { notify: true, digest: true });
    const r = await call(
      'POST',
      `/api/email/unsubscribe?t=${tok('digest')}`,
      'List-Unsubscribe=One-Click',
      {
        'content-type': 'application/x-www-form-urlencoded',
      },
    );
    expect(r.statusCode).toBe(200);
    expect(await prefs()).toMatchObject({ notify: true, digest: false });
  });

  it('pf4: без PLANAR_SECRET_KEY отписка → 503', async () => {
    const t = tok();
    delete process.env.PLANAR_SECRET_KEY;
    expect((await call('POST', `/api/email/unsubscribe?t=${t}`, undefined, {})).statusCode).toBe(
      503,
    );
  });
});

describe('pf4: настройки пользователя', () => {
  it('pf4: email.setPrefs — своя запись; чужой id → forbidden; неуказанное сохраняется', async () => {
    const c = w.member;
    await c.ok('email.setPrefs', { id: c.userId, digest: true });
    await c.ok('email.setPrefs', { id: c.userId, notify: false });
    const row = (
      await db.execute(sql`select notify, digest from email_prefs where id = ${c.userId}`)
    ).rows[0];
    expect(row).toMatchObject({ notify: false, digest: true });
    expect(await c.push('email.setPrefs', { id: w.admin.userId, notify: false })).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
  });
});
