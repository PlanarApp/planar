import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTokenCreatedSchema } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, world, type World } from '../sync/helpers.js';

// FW-1: операция записи выключенного модуля (chat не включён в воркспейсе) → 404 module_disabled, не 500
const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
let token: string;

beforeAll(async () => {
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.listen(0, '127.0.0.1');
  w = await world(db);
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie: await loginCookie(db, w.admin.userId), origin: ORIGIN },
      payload: { name: 't', scope: 'write' },
    });
  token = apiTokenCreatedSchema.parse(r.json()).secret;
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

describe('выключенный модуль в ext-операции записи', () => {
  it('chat выключен: создать канал → 404 module_disabled без имени мутатора', async () => {
    const r = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/v1/spaces/${w.spaceId}/chat/channels`,
        headers: { authorization: `Bearer ${token}` },
        payload: { id: w.spaceId, name: 'general' },
      });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ code: 'module_disabled' });
    expect(r.body).not.toContain('chat.channel.create');
  });
});
