import { createHmac, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Client } from '../lib.js';

export const MODULES = ['time', 'sprints', 'automations', 'webhooks', 'import'];

/** Включает модули work (добавляет к уже включённым); смена пишет _reset, клиенты перезагружаются. */
export async function enableModules(admin: Client): Promise<void> {
  const { data } = await admin.bootstrap();
  const cur = (data.settings?.find((s) => s.id === 'enabled_modules')?.value as string[]) ?? [];
  const next = [...new Set([...cur, ...MODULES])];
  if (next.length === cur.length) return;
  await admin.pushOk([admin.mut('settings.set', { id: 'enabled_modules', value: next })]);
}

/** YYYY-MM-DD в UTC со сдвигом в днях. */
export const utcDay = (shift = 0): string =>
  new Date(Date.now() + shift * 86_400_000).toISOString().slice(0, 10);

export interface Hit {
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Приёмник webhook в процессе Playwright: слушает все интерфейсы (api в контейнере ходит на host.docker.internal). */
export async function receiver() {
  const hits: Hit[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      hits.push({ headers: req.headers, body });
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '0.0.0.0', r));
  const port = (server.address() as AddressInfo).port;
  return {
    hits,
    url: `http://host.docker.internal:${port}/hook`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Эталон проверки подписи из docs/contracts/work.md. */
export function signatureOk(secret: string, rawBody: string, header: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  return (
    header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  );
}
