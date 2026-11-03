import { createHash } from 'node:crypto';
import { expect, request, test } from '@playwright/test';
import WebSocket from 'ws';
import { BASE, Client, ranks, uuidv7 } from '../lib.js';

test('Caddy: /api/health отвечает 200', async () => {
  const ctx = await request.newContext({ baseURL: BASE });
  expect((await ctx.get('/api/health')).status()).toBe(200);
});

test('Caddy: статика web и SPA-фолбэк', async () => {
  const ctx = await request.newContext({ baseURL: BASE });
  for (const p of ['/', '/some/client/route']) {
    const r = await ctx.get(p);
    expect(r.status()).toBe(200);
    expect(await r.text()).toContain('<div id="app"');
  }
});

test('вход admin и bootstrap через Caddy', async () => {
  const admin = await Client.login('admin');
  expect((await admin.bootstrap()).cursor).toBeGreaterThanOrEqual(0);
});

test('неверный пароль — 401', async () => {
  const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  const r = await ctx.post('/api/auth/login', { data: { login: 'admin', password: 'nope-nope' } });
  expect(r.status()).toBe(401);
});

const HEADERS = [
  'strict-transport-security',
  'x-content-type-options',
  'referrer-policy',
  'content-security-policy',
];

test('заголовки C-ops-headers на / и /api/health, Server нет', async () => {
  const ctx = await request.newContext({ baseURL: BASE });
  for (const p of ['/', '/api/health']) {
    const h = (await ctx.get(p)).headers();
    for (const n of HEADERS) expect(h[n], `${p} ${n}`).toBeTruthy();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['content-security-policy']).toContain("object-src 'none'");
    expect(h['server'], `${p} server`).toBeUndefined();
  }
});

test('задача, WS /ws и /collab, /f/*, файл по sha256', async () => {
  const admin = await Client.login('admin');
  const spaceId = uuidv7();
  const projectId = uuidv7();
  const statusIds = Array.from({ length: 5 }, () => uuidv7());
  const [r1, r2, r3] = ranks(3);
  const taskId = uuidv7();
  await admin.pushOk([
    admin.mut('space.create', {
      id: spaceId,
      name: `smoke ${spaceId}`,
      rank: r1,
      memberId: uuidv7(),
    }),
    admin.mut('project.create', {
      id: projectId,
      spaceId,
      name: 'Smoke',
      key: 'SMK',
      rank: r2,
      statusIds,
    }),
    admin.mut('task.create', {
      id: taskId,
      projectId,
      statusId: statusIds[0],
      title: 'smoke',
      rank: r3,
    }),
  ]);
  const boot = await admin.bootstrap();
  expect(boot.data.tasks!.some((t) => t.id === taskId)).toBe(true);

  const ws = await admin.ws(boot.cursor);
  ws.close();

  const cookie = await admin.cookie();
  await new Promise<void>((res, rej) => {
    const s = new WebSocket(`${BASE.replace(/^http/, 'ws')}/collab`, {
      headers: { Origin: BASE, Cookie: cookie },
    });
    s.once('open', () => (s.close(), res()));
    s.once('error', rej);
    s.once('unexpected-response', (_, r) => rej(new Error(`collab: ${r.statusCode}`)));
  });

  const ctx = await request.newContext({ baseURL: BASE });
  const f = await ctx.get(`/f/${uuidv7()}`);
  expect(f.status()).toBe(200);
  expect(f.headers()['content-type']).toContain('text/html');

  const body = Buffer.from(`smoke ${spaceId}`);
  const up = await admin.ctx.post('/files', {
    multipart: { file: { name: 's.txt', mimeType: 'text/plain', buffer: body } },
  });
  expect(up.status()).toBe(201);
  const { sha256 } = await up.json();
  const got = await (await admin.ctx.get(`/files/${sha256}`)).body();
  expect(createHash('sha256').update(got).digest('hex')).toBe(sha256);
});

test('главная после входа без нарушений CSP', async ({ page }) => {
  const admin = await Client.login('admin');
  await page.context().addCookies((await admin.ctx.storageState()).cookies);
  const bad: string[] = [];
  page.on('console', (m) => /content security policy/i.test(m.text()) && bad.push(m.text()));
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (e) =>
      console.error(`CSP violation: ${e.violatedDirective}`),
    ),
  );
  await page.goto(BASE + '/');
  await page.waitForLoadState('networkidle');
  expect(bad).toEqual([]);
});
