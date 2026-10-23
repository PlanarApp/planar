import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import WebSocket from 'ws';
import { apiTokenCreatedSchema, uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { apiTokens } from '../../src/db/schema.js';
import { ORIGIN, createUser, loginCookie } from '../auth.js';
import { dbUrl, newDb } from '../sync/helpers.js';

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let wsUrl: string;

beforeAll(async () => {
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.listen(0, '127.0.0.1');
  wsUrl = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/ws`;
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

const inject = (
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  headers: object,
  payload?: object,
) => app.getHttpAdapter().getInstance().inject({ method, url, headers, payload });

async function tokens() {
  const u = await createUser(db);
  const cookie = await loginCookie(db, u.id);
  const out = {} as Record<'read' | 'write', { secret: string; id: string }>;
  for (const scope of ['read', 'write'] as const) {
    const r = await inject('POST', '/api/tokens', { cookie, origin: ORIGIN }, { name: 't', scope });
    const b = apiTokenCreatedSchema.parse(r.json());
    out[scope] = { secret: b.secret, id: b.token.id };
  }
  return out;
}

const VARIANTS = (base: string) => {
  const [a, b] = base.split('/').filter(Boolean) as [string, string];
  return [
    `/${a}/${b.replace(/^./, (c) => '%' + c.charCodeAt(0).toString(16))}`,
    `//${a}/${b}`,
    `/${a}/${b[0]!.toUpperCase()}${b.slice(1)}`,
    `/${a}/${b}/`,
  ];
};

describe('обход guard: /api/tokens', () => {
  it.each(['GET', 'POST', 'DELETE'] as const)('%s: ни одного 2xx для read и write', async (m) => {
    const t = await tokens();
    for (const scope of ['read', 'write'] as const)
      for (const url of VARIANTS('/api/tokens'))
        for (const suffix of ['', `/${uuidv7()}`]) {
          const r = await inject(
            m,
            url + suffix,
            { authorization: `Bearer ${t[scope].secret}` },
            m === 'POST' ? { name: 'x', scope: 'read' } : undefined,
          );
          expect(r.statusCode, `${m} ${url}${suffix} ${scope}`).toBeGreaterThanOrEqual(400);
        }
  });
});

describe('обход guard: /sync/push', () => {
  it.each(VARIANTS('/sync/push'))('read-токен POST %s → не 2xx', async (url) => {
    const t = await tokens();
    const r = await inject(
      'POST',
      url,
      { authorization: `Bearer ${t.read.secret}` },
      { clientId: uuidv7(), mutations: [] },
    );
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('WS /ws по Bearer', () => {
  it.each(['read', 'write'] as const)(
    '%s-токен → 4401, last_used_at не обновлён',
    async (scope) => {
      const t = await tokens();
      const ws = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${t[scope].secret}` } });
      const code = await new Promise<number>((res) => {
        ws.on('close', res);
        ws.on('error', () => res(-1));
      });
      expect(code).toBe(4401);
      const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, t[scope].id));
      expect(row!.lastUsedAt).toBeNull();
    },
  );
});
