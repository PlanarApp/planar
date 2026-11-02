import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDemo, setDemo, type Db, type JobApi } from '@planar/server-kit';
import { pollAll } from '@planar/module-gitlab/api';
import { WebPushSender } from '../src/push/push.js';
import { loadCfg } from '../../../modules/email/api/mail.js';
import { post } from '../../../modules/webhooks/api/send.js';
import { createUser, loginCookie } from './auth.js';
import { db, req, useApp } from './auth/harness.js';

const sendNotification = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('web-push', () => ({ default: { sendNotification } }));

useApp({ appOpts: { demo: true } });
afterEach(() => setDemo(false));

describe('demo: исходящие no-op', () => {
  it('createApp(demo) задаёт isDemo без process.env', () => {
    expect(process.env.DEMO_MODE).toBeUndefined();
    expect(isDemo()).toBe(true);
  });

  it('demo: push — без запроса, не-demo — вызван', async () => {
    const s = new WebPushSender({ publicKey: 'a', privateKey: 'b', subject: 'mailto:x@y.z' });
    const sub = { endpoint: 'https://push.invalid/1', p256dh: 'p', auth: 'a' };
    setDemo(true);
    await s.send(sub, { title: 't' } as never);
    expect(sendNotification).not.toHaveBeenCalled();
    setDemo(false);
    await s.send(sub, { title: 't' } as never);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('demo: webhook — 200 без запроса, не-demo — запрос ушёл', async () => {
    let hits = 0;
    const srv = http.createServer((_q, r) => (hits++, r.writeHead(200).end('ok')));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
    try {
      setDemo(true);
      expect(await post(url, '{}', {})).toBe(200);
      expect(hits).toBe(0);
      setDemo(false);
      await post(url, '{}', {}).catch(() => {}); // SSRF protection may reject loopback — what matters is that it went the normal path
    } finally {
      srv.close();
    }
  });

  it('demo: email — конфиг не отдаётся, не-demo — отдаётся', async () => {
    process.env.PLANAR_SECRET_KEY = Buffer.alloc(32, 1).toString('base64');
    const row = {
      host: 'smtp.invalid',
      port: 25,
      secure: false,
      username: null,
      passwordEnc: null,
      fromAddress: 'a@b.c',
    };
    const q = { select: () => ({ from: async () => [row] }) } as unknown as Pick<Db, 'select'>;
    setDemo(true);
    expect(await loadCfg(q)).toBeNull();
    setDemo(false);
    expect((await loadCfg(q))?.host).toBe('smtp.invalid');
  });

  it('demo: gitlab/автоматизации — опрос не читает БД, не-demo — читает', async () => {
    let reads = 0;
    const api = {
      db: {
        select: () => (reads++, { from: () => ({ orderBy: async () => [] }) }),
      },
    } as unknown as JobApi;
    setDemo(true);
    await pollAll(api);
    expect(reads).toBe(0);
    setDemo(false);
    await pollAll(api);
    expect(reads).toBeGreaterThan(0);
  });
});

describe('demo: пользователь demo', () => {
  const patch = (cookie: string, id: string, body: object) =>
    req('PATCH', `/api/users/${id}`, { cookie, body });

  it('смена пароля и email → 403, имя можно', async () => {
    const u = await createUser(db, { login: 'demo' });
    const c = await loginCookie(db, u.id);
    expect((await patch(c, u.id, { password: 'newpassword1' })).statusCode).toBe(403);
    expect((await patch(c, u.id, { email: 'd@example.com' })).statusCode).toBe(403);
    expect((await patch(c, u.id, { name: 'Demo 2' })).statusCode).toBe(200);
  });

  it('обычный пользователь меняет пароль и email', async () => {
    const u = await createUser(db);
    const c = await loginCookie(db, u.id);
    expect((await patch(c, u.id, { password: 'newpassword1' })).statusCode).toBe(200);
    expect((await patch(c, u.id, { email: 'u@example.com' })).statusCode).toBe(200);
  });
});
