import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractSchemas, uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { ORIGIN, createUser, loginCookie } from '../auth.js';
import { dbUrl, mkSpace, newDb } from './helpers.js';

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

const req = (
  method: 'GET' | 'POST',
  url: string,
  cookie?: string,
  payload?: unknown,
  origin = ORIGIN,
) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      headers: { ...(cookie && { cookie }), origin },
      payload: payload as object,
    });

async function user() {
  const u = await createUser(db);
  return { u, cookie: await loginCookie(db, u.id), clientId: uuidv7() };
}

describe('HTTP /sync', () => {
  it.each([
    ['GET', `/sync/bootstrap?clientId=${uuidv7()}`],
    ['GET', `/sync/pull?cursor=0&clientId=${uuidv7()}`],
    ['POST', '/sync/push'],
    ['GET', `/api/tasks/${uuidv7()}/activity`],
  ] as const)('%s %s без входа → 401', async (m, url) => {
    const r = await req(m, url);
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('unauthenticated');
  });

  it('bootstrap → валидный ответ', async () => {
    const { cookie, clientId } = await user();
    const r = await req('GET', `/sync/bootstrap?clientId=${clientId}`, cookie);
    expect(r.statusCode).toBe(200);
    expect(contractSchemas['sync.bootstrap'].safeParse(r.json()).success).toBe(true);
  });

  it('bootstrap/pull с неверными параметрами → 400 invalid_request', async () => {
    const { cookie, clientId } = await user();
    for (const url of [
      '/sync/bootstrap',
      '/sync/bootstrap?clientId=x',
      `/sync/pull?clientId=${clientId}`,
      `/sync/pull?cursor=-1&clientId=${clientId}`,
      `/sync/pull?cursor=abc&clientId=${clientId}`,
    ]) {
      const r = await req('GET', url, cookie);
      expect(r.statusCode, url).toBe(400);
      expect(r.json().code).toBe('invalid_request');
    }
  });

  it('push: ответ валиден, pull видит результат, повтор идемпотентен', async () => {
    const { u, cookie, clientId } = await user();
    const spaceId = await mkSpace(db, u.id, { [u.id]: 'admin' });
    const body = {
      clientId,
      mutations: [
        { id: 1, name: 'label.create', args: { id: uuidv7(), spaceId, name: 'x', color: '#000' } },
      ],
    };
    const { cursor } = (await req('GET', `/sync/bootstrap?clientId=${clientId}`, cookie)).json();
    const r1 = await req('POST', '/sync/push', cookie, body);
    expect(r1.statusCode).toBe(200);
    expect(contractSchemas['sync.pushResponse'].safeParse(r1.json()).success).toBe(true);
    expect(r1.json()).toEqual({ results: [{ id: 1, ok: true }] });
    expect((await req('POST', '/sync/push', cookie, body)).json()).toEqual({
      results: [{ id: 1, ok: true }],
    });
    const p = (await req('GET', `/sync/pull?cursor=${cursor}&clientId=${clientId}`, cookie)).json();
    expect(contractSchemas['sync.pull'].safeParse(p).success).toBe(true);
    expect(p.lastMutationId).toBe(1);
    expect(p.changes.filter((c: { entity: string }) => c.entity === 'labels')).toHaveLength(1);
  });

  it('push: неверное тело → 400, > 100 мутаций → 400', async () => {
    const { cookie, clientId } = await user();
    expect(
      (await req('POST', '/sync/push', cookie, { clientId: 'x', mutations: [] })).statusCode,
    ).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => ({ id: i + 1, name: 'x', args: {} }));
    expect(
      (await req('POST', '/sync/push', cookie, { clientId, mutations: many })).statusCode,
    ).toBe(400);
  });

  it('push: тело > 1 МБ → 413 payload_too_large', async () => {
    const { cookie, clientId } = await user();
    const big = 'a'.repeat(1024 * 1024 + 10);
    const r = await req('POST', '/sync/push', cookie, {
      clientId,
      mutations: [{ id: 1, name: 'x', args: big }],
    });
    expect(r.statusCode).toBe(413);
    expect(r.json().code).toBe('payload_too_large');
  });

  it('push: чужой clientId → 403 forbidden', async () => {
    const a = await user();
    const b = await user();
    const mut = { id: 1, name: 'nope', args: {} };
    await req('POST', '/sync/push', a.cookie, { clientId: a.clientId, mutations: [mut] });
    const r = await req('POST', '/sync/push', b.cookie, {
      clientId: a.clientId,
      mutations: [{ ...mut, id: 2 }],
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('forbidden');
  });

  it('push с чужим Origin → 403 origin_mismatch', async () => {
    const { cookie, clientId } = await user();
    const r = await req(
      'POST',
      '/sync/push',
      cookie,
      { clientId, mutations: [] },
      'http://evil.example',
    );
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('origin_mismatch');
  });

  it('GET /api/tasks/:id/activity: участник видит, посторонний и неверный id → 404', async () => {
    const a = await user();
    const o = await user();
    const spaceId = await mkSpace(db, a.u.id, { [a.u.id]: 'admin' });
    const ok = await req('POST', '/sync/push', a.cookie, {
      clientId: a.clientId,
      mutations: [
        {
          id: 1,
          name: 'project.create',
          args: {
            id: uuidv7(),
            spaceId,
            name: 'P',
            key: `K${uuidv7()
              .slice(-8)
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, 'Z')}`,
            rank: 'a0',
          },
        },
      ],
    });
    expect(ok.json().results[0].ok).toBe(true);
    const taskId = uuidv7();
    expect((await req('GET', `/api/tasks/${taskId}/activity`, a.cookie)).statusCode).toBe(404);
    expect((await req('GET', `/api/tasks/${taskId}/activity`, o.cookie)).statusCode).toBe(404);
    expect((await req('GET', '/api/tasks/not-a-uuid/activity', a.cookie)).statusCode).toBe(404);
  });
});
