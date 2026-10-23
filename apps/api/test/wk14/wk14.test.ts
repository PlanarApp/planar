import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { settings } from '../../src/db/schema.js';
import { installed, validateInstalled } from '../../src/modules/installed.js';
import { ORIGIN, createUser, loginCookie } from '../auth.js';
import { testDb, testDbUrl } from '../db.js';

const db = testDb();
let app: Awaited<ReturnType<typeof createApp>>;
let alice: string;
let bob: string;
let sha: string;
const hello = installed.find((m) => m.api.id === 'hello')!.api;
const inject = (
  method: 'GET' | 'POST',
  url: string,
  cookie: string,
  payload?: Buffer,
  ct?: string,
) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      headers: { cookie, origin: ORIGIN, ...(ct ? { 'content-type': ct } : {}) },
      payload,
    });
const enable = (ids: string[]) =>
  db
    .insert(settings)
    .values({ id: 'enabled_modules', value: ids })
    .onConflictDoUpdate({ target: settings.id, set: { value: ids } });

beforeAll(async () => {
  app = await createApp({
    databaseUrl: testDbUrl(),
    publicUrl: ORIGIN,
    dataDir: mkdtempSync(join(tmpdir(), 'planar-wk14-')),
    maxUploadMb: 1,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  alice = await loginCookie(db, (await createUser(db)).id);
  bob = await loginCookie(db, (await createUser(db)).id);
  const b = '----wk14';
  const payload = Buffer.concat([
    Buffer.from(
      `--${b}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\n`,
    ),
    Buffer.from('wk14 ' + Math.random()),
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  const r = await inject('POST', '/files', alice, payload, `multipart/form-data; boundary=${b}`);
  sha = r.json().sha256;
});
afterAll(async () => {
  delete hello.canReadFile;
  await app.close();
  await db.$client.end();
});
beforeEach(() => {
  delete hello.canReadFile;
});

describe('wk14: canReadFile', () => {
  it('wk14: без canReadFile чужой файл → 404', async () => {
    await enable(['hello']);
    expect((await inject('GET', `/files/${sha}`, bob)).statusCode).toBe(404);
  });

  it('wk14: модуль вернул true → 200; все false → 404', async () => {
    await enable(['hello']);
    const f = vi.fn(async () => true);
    hello.canReadFile = f;
    expect((await inject('GET', `/files/${sha}`, bob)).statusCode).toBe(200);
    expect(f).toHaveBeenCalledWith(expect.anything(), expect.any(String), sha);
    hello.canReadFile = async () => false;
    expect((await inject('GET', `/files/${sha}`, bob)).statusCode).toBe(404);
  });

  it('wk14: выключенный модуль не спрашивается', async () => {
    await enable([]);
    const f = vi.fn(async () => true);
    hello.canReadFile = f;
    expect((await inject('GET', `/files/${sha}`, bob)).statusCode).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });

  it('wk14: встроенный доступ (загрузивший) модуля не спрашивает', async () => {
    await enable(['hello']);
    const f = vi.fn(async () => false);
    hello.canReadFile = f;
    expect((await inject('GET', `/files/${sha}`, alice)).statusCode).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('wk14: meta.members', () => {
  const m = installed[0]!;
  const ent = (members: unknown) => {
    const [name, e] = Object.entries(m.api.entities)[0]!;
    return [
      { ...m, api: { ...m.api, entities: { [name]: { ...e, meta: { ...e.meta, members } } } } },
    ];
  };
  it('wk14: верная форма проходит', () => {
    const ok = { entity: 'a', key: 'b', container: 'c', via: 'id' };
    expect(() => validateInstalled(ent(ok))).not.toThrow();
  });
  it.each([{ entity: 'a' }, { entity: 'a', key: 1, container: 'c', via: 'id' }, 'x'])(
    'wk14: неверная форма %j → ошибка загрузки',
    (bad) => {
      expect(() => validateInstalled(ent(bad))).toThrow(/members/);
    },
  );
});
