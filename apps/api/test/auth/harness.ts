import { afterAll, beforeAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { ORIGIN } from '../auth.js';
import { testDb, testDbUrl } from '../db.js';

export const db = testDb();
let app: Awaited<ReturnType<typeof createApp>>;

/** Приложение на базе файла; req(method, url, {cookie?, body?}) — с верным Origin. */
export function useApp() {
  beforeAll(async () => {
    app = await createApp({ databaseUrl: testDbUrl(), publicUrl: ORIGIN });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app.close();
    await db.$client.end();
  });
}

export const req = (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  o: { cookie?: string; body?: unknown; origin?: string | null } = {},
) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      payload: o.body as object | undefined,
      headers: {
        ...(o.cookie && { cookie: o.cookie }),
        ...(o.origin !== null && { origin: o.origin ?? ORIGIN }),
      },
    });
