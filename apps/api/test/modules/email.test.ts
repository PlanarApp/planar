import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { settings } from '../../src/db/schema.js';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { TestClient, services } from '../sync/helpers.js';
import { emailConfig } from '@planar/module-email/api/schema';

useApp();

let ia: TestClient;
let cookie: string;
const setModules = (value: unknown) => ia.push('settings.set', { id: 'enabled_modules', value });
const list = async () =>
  (
    await getApp()
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/api/modules', headers: { cookie, origin: ORIGIN } })
  ).json().modules as { id: string; enabled: boolean; unavailable: string | null }[];

beforeAll(async () => {
  const u = await createUser(db, { role: 'admin' });
  ia = new TestClient(services(db), u.id);
  cookie = await loginCookie(db, u.id);
});
afterAll(async () => {
  await db.delete(emailConfig);
  await db.delete(settings).where(eq(settings.id, 'enabled_modules'));
});

describe('pf4: недоступность модуля email', () => {
  it('pf4: без настроек GET /api/modules → unavailable smtp_not_configured', async () => {
    expect((await list()).find((m) => m.id === 'email')).toMatchObject({
      enabled: false,
      unavailable: 'smtp_not_configured',
    });
    expect((await list()).find((m) => m.id === 'hello')!.unavailable).toBeNull();
  });

  it('pf4: settings.set enabled_modules с email без SMTP → invalid_args с кодом', async () => {
    expect(await setModules(['email'])).toMatchObject({
      ok: false,
      code: 'invalid_args',
      message: expect.stringContaining('smtp_not_configured'),
    });
    expect(await setModules(['hello'])).toMatchObject({ ok: true });
  });

  it('pf4: после настройки SMTP модуль включается; уже включённый не перепроверяется', async () => {
    await db
      .insert(emailConfig)
      .values({ id: 'default', host: 'smtp.test', port: 25, fromAddress: 'a@b.test' });
    expect(await setModules(['hello', 'email'])).toMatchObject({ ok: true });
    expect((await list()).find((m) => m.id === 'email')).toMatchObject({
      enabled: true,
      unavailable: null,
    });
    await db.delete(emailConfig);
    expect(await setModules(['email', 'hello'])).toMatchObject({ ok: true });
    expect(await setModules([])).toMatchObject({ ok: true });
  });
});
