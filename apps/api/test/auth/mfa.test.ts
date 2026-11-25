import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/auth/password.js';
import { totpCode, verifyTotp } from '../../src/auth/totp.js';
import { passkeys, sessions, settings, users } from '../../src/db/schema.js';
import { createUser, loginCookie } from '../auth.js';
import { db, req, useApp } from './harness.js';

useApp();

const PASSWORD = 'secret-pass-1';
const step = () => Math.floor(Date.now() / 30_000);
const cookieOf = (r: { headers: Record<string, unknown> }) =>
  String(r.headers['set-cookie']).split(';')[0]!;

async function userWithPassword(role: 'admin' | 'member' = 'member') {
  const u = await createUser(db, { role });
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(PASSWORD) })
    .where(eq(users.id, u.id));
  return u;
}

/** TOTP on: returns the secret and recovery codes. */
async function enableTotp(cookie: string) {
  const s = (await req('POST', '/api/auth/totp/setup', { cookie })).json();
  expect(s.uri).toContain(`secret=${s.secret}`);
  expect(s.qr).toMatch(/^data:image\/png;base64,/);
  const r = await req('POST', '/api/auth/totp/enable', {
    cookie,
    body: { code: totpCode(s.secret, step()) },
  });
  expect(r.statusCode).toBe(200);
  return { secret: s.secret as string, codes: r.json().recoveryCodes as string[] };
}

const login = (login: string) =>
  req('POST', '/api/auth/login', { body: { login, password: PASSWORD } });

describe('TOTP', () => {
  it('RFC 6238: вектор SHA-1 и защита от повтора шага', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
    expect(totpCode(secret, 1)).toBe('287082'); // T=59 → 94287082
    const now = 59_000;
    expect(verifyTotp(secret, '287082', null, now)).toBe(1);
    expect(verifyTotp(secret, '287082', 1, now)).toBeNull();
    expect(verifyTotp(secret, '000000', null, now)).toBeNull();
  });
});

describe('двухфакторный вход', () => {
  it('пароль → сессия mfa (только verify) → код → полная сессия; резервный код — один раз', async () => {
    const u = await userWithPassword();
    const { secret, codes } = await enableTotp(await loginCookie(db, u.id));
    expect(codes).toHaveLength(10);

    const r = await login(u.login);
    expect(r.json()).toEqual({ mfa: { totp: true, passkey: false } });
    const pending = cookieOf(r);
    expect((await req('GET', '/api/auth/me', { cookie: pending })).statusCode).toBe(401);
    expect((await req('GET', '/api/v1/spaces', { cookie: pending })).statusCode).toBe(401);
    const bad = await req('POST', '/api/auth/mfa/verify', {
      cookie: pending,
      body: { code: '000000' },
    });
    expect(bad.statusCode).toBe(401);

    const ok = await req('POST', '/api/auth/mfa/verify', {
      cookie: pending,
      body: { code: totpCode(secret, step() + 1) },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.id).toBe(u.id);
    const full = cookieOf(ok);
    expect((await req('GET', '/api/v1/spaces', { cookie: full })).statusCode).toBe(200);
    expect((await req('GET', '/api/auth/me', { cookie: pending })).statusCode).toBe(401);

    for (const expected of [200, 401]) {
      const c = cookieOf(await login(u.login));
      const v = await req('POST', '/api/auth/mfa/verify', {
        cookie: c,
        body: { code: codes[0]!.toUpperCase() },
      });
      expect(v.statusCode).toBe(expected);
    }
    const sec = (await req('GET', '/api/auth/security', { cookie: full })).json();
    expect([sec.totp, sec.recoveryLeft]).toEqual([true, 9]);
  });

  it('политика «всем»: без фактора — только настройка, затем полная сессия; последний фактор не снять', async () => {
    const u = await userWithPassword();
    await db
      .insert(settings)
      .values({ id: 'workspace', value: { mfa: 'all' } })
      .onConflictDoUpdate({ target: settings.id, set: { value: { mfa: 'all' } } });
    try {
      const r = await login(u.login);
      expect(r.json().mfaSetup).toBe(true);
      const cookie = cookieOf(r);
      const blocked = await req('GET', '/api/v1/spaces', { cookie });
      expect([blocked.statusCode, blocked.json().code]).toEqual([403, 'mfa_setup_required']);
      expect((await req('GET', '/api/auth/security', { cookie })).json()).toMatchObject({
        required: true,
        setup: true,
      });
      const { secret } = await enableTotp(cookie);
      expect((await req('GET', '/api/v1/spaces', { cookie })).statusCode).toBe(200);
      const off = await req('POST', '/api/auth/totp/disable', {
        cookie,
        body: { code: totpCode(secret, step() + 1) },
      });
      expect(off.statusCode).toBe(409);
    } finally {
      await db.delete(settings).where(eq(settings.id, 'workspace'));
    }
  });

  it('админ сбрасывает 2FA участнику: вход снова только по паролю', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const u = await userWithPassword();
    await enableTotp(await loginCookie(db, u.id));
    expect((await login(u.login)).json().mfa).toBeTruthy();
    const r = await req('PATCH', `/api/v1/instance/users/${u.id}`, {
      cookie: await loginCookie(db, admin.id),
      body: { reset2fa: true },
    });
    expect(r.statusCode).toBe(200);
    expect((await login(u.login)).json().user.id).toBe(u.id);
  });
});

describe('блокировка приложения', () => {
  it('без фактора не включить; lock → 423 кроме auth; разблокировка кодом; простой — блокирует сервер', async () => {
    const u = await userWithPassword();
    const cookie = await loginCookie(db, u.id);
    const lock = { lockOnOpen: false, lockMinutes: 5, lockWipe: false };
    expect((await req('PATCH', '/api/auth/lock', { cookie, body: lock })).statusCode).toBe(409);
    const { secret, codes } = await enableTotp(cookie);
    expect((await req('PATCH', '/api/auth/lock', { cookie, body: lock })).statusCode).toBe(200);

    expect((await req('POST', '/api/auth/lock', { cookie })).statusCode).toBe(204);
    const r = await req('GET', '/api/v1/spaces', { cookie });
    expect([r.statusCode, r.json().code]).toEqual([423, 'locked']);
    expect((await req('GET', '/api/auth/me', { cookie })).statusCode).toBe(200);
    const un = await req('POST', '/api/auth/unlock', {
      cookie,
      body: { code: totpCode(secret, step() + 1) },
    });
    expect(un.statusCode).toBe(204);
    expect((await req('GET', '/api/v1/spaces', { cookie })).statusCode).toBe(200);

    await db
      .update(sessions)
      .set({ lastSeenAt: sql`now() - interval '6 minutes'` })
      .where(eq(sessions.userId, u.id));
    expect((await req('GET', '/api/v1/spaces', { cookie })).statusCode).toBe(423);
    // the lock is kept even though the request touched lastSeenAt
    expect((await req('GET', '/api/v1/spaces', { cookie })).statusCode).toBe(423);

    // «on every open» alone: the server locks after 3 minutes without requests
    const un2 = await req('POST', '/api/auth/unlock', { cookie, body: { code: codes[0] } });
    expect(un2.statusCode).toBe(204);
    const onOpen = { lockOnOpen: true, lockMinutes: null, lockWipe: false };
    expect((await req('PATCH', '/api/auth/lock', { cookie, body: onOpen })).statusCode).toBe(200);
    expect((await req('GET', '/api/auth/me', { cookie })).json()).toMatchObject(onOpen);
    await db
      .update(sessions)
      .set({ lastSeenAt: sql`now() - interval '2 minutes'` })
      .where(eq(sessions.userId, u.id));
    expect((await req('GET', '/api/v1/spaces', { cookie })).statusCode).toBe(200);
    await db
      .update(sessions)
      .set({ lastSeenAt: sql`now() - interval '4 minutes'` })
      .where(eq(sessions.userId, u.id));
    expect((await req('GET', '/api/v1/spaces', { cookie })).statusCode).toBe(423);
  });
});

describe('passkey', () => {
  it('параметры входа: RP — хост Origin; чужой Origin — 403; поддельный ответ — 401', async () => {
    const o = await req('POST', '/api/auth/passkey/options');
    expect(o.statusCode).toBe(200);
    expect(o.json().options.rpId).toBe('localhost');
    expect(
      (await req('POST', '/api/auth/passkey/options', { origin: 'https://evil.example' }))
        .statusCode,
    ).toBe(403);
    const r = await req('POST', '/api/auth/passkey/login', {
      body: { challengeId: o.json().challengeId, response: { id: 'nope', response: {} } },
    });
    expect(r.statusCode).toBe(401);
  });

  it('удаление: свой ключ — 204, чужой не трогается; без факторов «Заблокировать» не блокирует', async () => {
    const u = await userWithPassword();
    const other = await userWithPassword();
    const key = { name: 'k', publicKey: 'x', counter: 0 };
    await db.insert(passkeys).values([
      { ...key, id: 'own-key_1', userId: u.id },
      { ...key, id: 'other-key', userId: other.id },
    ]);
    const cookie = await loginCookie(db, u.id);
    expect((await req('GET', '/api/auth/me', { cookie })).json().canLock).toBe(true);
    for (const id of ['other-key', 'own-key_1'])
      expect((await req('DELETE', `/api/auth/passkeys/${id}`, { cookie })).statusCode).toBe(204);
    expect((await db.select().from(passkeys)).map((k) => k.id)).toContain('other-key');
    expect((await req('GET', '/api/auth/security', { cookie })).json().passkeys).toEqual([]);
    expect((await req('GET', '/api/auth/me', { cookie })).json().canLock).toBe(false);
    await req('POST', '/api/auth/lock', { cookie });
    expect((await req('GET', '/api/v1/spaces', { cookie })).statusCode).toBe(200);
  });
});
