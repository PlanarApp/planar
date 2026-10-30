import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { parseTrustProxy } from '../../src/config.js';
import { ORIGIN } from '../auth.js';
import { testDbUrl } from '../db.js';

async function failures(trustProxy: string[], remoteAddress: string, xffs: string[]) {
  const app = await createApp({ databaseUrl: testDbUrl(), publicUrl: ORIGIN, trustProxy });
  await app.init();
  const f = app.getHttpAdapter().getInstance();
  await f.ready();
  const codes: number[] = [];
  const login = `nobody${Math.random().toString(36).slice(2)}`;
  for (const xff of xffs)
    codes.push(
      (
        await f.inject({
          method: 'POST',
          url: '/api/auth/login',
          remoteAddress,
          headers: { 'x-forwarded-for': xff },
          payload: { login, password: 'password1' },
        })
      ).statusCode,
    );
  await app.close();
  return codes;
}

// 11 attempts with different X-Forwarded-For: the limit triggers only if the address is the same
const many = Array.from({ length: 11 }, (_, i) => `9.9.9.${i + 1}`);
const same = Array.from({ length: 11 }, () => '9.9.9.9');
const addr = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;

describe('TRUST_PROXY', () => {
  it('pt9: пусто — X-Forwarded-For игнорируется, лимит по адресу соединения', async () => {
    expect((await failures([], addr(), many)).at(-1)).toBe(429);
  });

  it('pt9: недоверенный адрес соединения — заголовок игнорируется', async () => {
    expect((await failures(['172.30.0.0/24'], addr(), many)).at(-1)).toBe(429);
  });

  it('pt9: доверенный — клиенты из заголовка считаются раздельно', async () => {
    expect(await failures(['172.30.0.0/24'], '172.30.0.2', many)).not.toContain(429);
  });

  it('pt9: доверенный — один клиент в заголовке упирается в лимит', async () => {
    expect((await failures(['172.30.0.0/24'], '172.30.0.2', same)).at(-1)).toBe(429);
  });

  it('pt9: parseTrustProxy принимает IP/CIDR, отвергает true и мусор', () => {
    expect(parseTrustProxy(undefined)).toEqual([]);
    expect(parseTrustProxy(' 172.30.0.0/24, ::1 ')).toEqual(['172.30.0.0/24', '::1']);
    for (const bad of ['true', 'caddy', '1.2.3.4/33', '1.2.3.4/x'])
      expect(() => parseTrustProxy(bad)).toThrow(/TRUST_PROXY/);
  });
});
