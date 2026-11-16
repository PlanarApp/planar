import { lookup } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { eq } from 'drizzle-orm';
import { HttpError } from '../../auth/errors.js';
import * as s from '../../db/schema.js';
import { toWire } from '../../sync/rows.js';
import type { ExtDeps } from './types.js';

const TOO_BIG = () => new HttpError(413, 'payload_too_large', 'Файл слишком большой');
const bad = (m: string) => new HttpError(400, 'invalid_request', m);

// loopback, private, link-local (cloud metadata), CGNAT, multicast, reserved; IPv6 equivalents
const blocked = new BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(a, p, 'ipv6');

export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (!v) return true;
  // ::ffff:a.b.c.d is the IPv4 address a.b.c.d
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (m) return blocked.check(m[1]!, 'ipv4');
  return blocked.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Downloads a public http(s) URL into memory, at most maxBytes. SSRF guard: only http/https, no internal addresses —
 * checked on the address actually connected to (the lookup hook), so DNS rebinding does not help; redirects are not followed.
 * `allowPrivate` is for tests only.
 */
export function downloadUrl(
  raw: string,
  maxBytes: number,
  allowPrivate = false,
): Promise<{ buf: Buffer; mime: string }> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw bad('Неверный URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad('Только http и https');
  if (u.username || u.password) throw bad('URL с логином и паролем не поддерживается');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && isIP(host) && isBlockedIp(host)) throw bad('Внутренний адрес запрещён');
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(
      u,
      {
        timeout: 15_000,
        agent: false, // no pooled sockets: every request goes through the lookup check
        lookup: (h, o, cb) =>
          lookup(h, { ...(o as object), all: true }, (err, addrs) => {
            const list = (addrs ?? []) as { address: string; family: number }[];
            if (err) return (cb as (e: Error) => void)(err);
            if (!allowPrivate && list.some((a) => isBlockedIp(a.address)))
              return (cb as (e: Error) => void)(bad('Внутренний адрес запрещён'));
            const a = list[0]!;
            if ((o as { all?: boolean }).all) (cb as (e: null, l: unknown) => void)(null, list);
            else (cb as (e: null, a: string, f: number) => void)(null, a.address, a.family);
          }),
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(bad(`Источник ответил ${res.statusCode}`));
        }
        if (Number(res.headers['content-length']) > maxBytes) {
          res.resume();
          return reject(TOO_BIG());
        }
        const chunks: Buffer[] = [];
        let n = 0;
        res.on('data', (c: Buffer) => {
          n += c.length;
          if (n > maxBytes) {
            req.destroy();
            return reject(TOO_BIG());
          }
          chunks.push(c);
        });
        res.on('end', () =>
          resolve({
            buf: Buffer.concat(chunks),
            mime: (res.headers['content-type'] ?? '').split(';')[0]!.trim(),
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(bad('Источник не отвечает')));
    req.on('error', (e) => reject(e instanceof HttpError ? e : bad('Не удалось скачать файл')));
    req.end();
  });
}

export async function taskAttachments(d: ExtDeps, taskId: string) {
  const rows = await d.db
    .select()
    .from(s.attachments)
    .where(eq(s.attachments.taskId, taskId))
    .orderBy(s.attachments.createdAt, s.attachments.id);
  return rows.map((r) => toWire('attachments', r));
}
