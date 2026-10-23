import { expect, request, test } from '@playwright/test';
import { BASE, Client } from '../lib.js';

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
