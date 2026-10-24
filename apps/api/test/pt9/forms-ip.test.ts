import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { settings } from '../../src/db/schema.js';
import { ORIGIN } from '../auth.js';
import { testDbUrl } from '../db.js';
import { newDb, world } from '../sync/helpers.js';

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let slug: string;
const rnd = () => Math.floor(Math.random() * 250) + 1;
const ok = { values: { title: 'r', email: 'a@b.ru' }, website: '' };

const post = (remoteAddress: string, xff: string) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: `/api/forms/public/${slug}`,
      payload: ok,
      remoteAddress,
      headers: { 'x-forwarded-for': xff },
    });
// 5 отправок проходят, 6-я — 429
const burst = async (remote: string, xff: string) => {
  for (let i = 0; i < 5; i++) expect((await post(remote, xff)).statusCode).toBe(201);
  return (await post(remote, xff)).statusCode;
};

beforeAll(async () => {
  const w = await world(db);
  await db
    .insert(settings)
    .values({ id: 'enabled_modules', value: ['forms'] })
    .onConflictDoUpdate({
      target: settings.id,
      set: { value: ['forms'] },
    });
  slug = Math.random().toString(36).slice(2).padEnd(16, 'a').slice(0, 16);
  await w.admin.ok('forms.create', {
    id: uuidv7(),
    projectId: w.projectId,
    slug,
    title: 'Форма',
    statusId: w.statusIds[2],
    fields: [
      { key: 'title', label: 'Тема', required: true },
      { key: 'email', label: 'Email', required: true },
    ],
  });
  app = await createApp({
    databaseUrl: testDbUrl(),
    publicUrl: ORIGIN,
    dataDir: mkdtempSync(join(tmpdir(), 'planar-pt9-')),
    trustProxy: ['172.30.0.0/24'],
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

describe('TRUST_PROXY: публичные формы', () => {
  it('pt9: за доверенным прокси лимит формы по клиенту из X-Forwarded-For', async () => {
    const a = `8.${rnd()}.${rnd()}.1`;
    const b = `8.${rnd()}.${rnd()}.2`;
    expect(await burst('172.30.0.2', a)).toBe(429);
    expect((await post('172.30.0.2', b)).statusCode).toBe(201); // другой клиент не делит лимит
    expect((await post('172.30.0.2', a)).statusCode).toBe(429);
  });

  it('pt9: недоверенный адрес — X-Forwarded-For игнорируется, лимит по соединению', async () => {
    const remote = `10.${rnd()}.${rnd()}.9`;
    expect(await burst(remote, `8.${rnd()}.${rnd()}.3`)).toBe(429);
    expect((await post(remote, `8.${rnd()}.${rnd()}.4`)).statusCode).toBe(429);
  });
});
