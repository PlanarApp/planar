import { createHmac } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { safeAddress } from './ssrf.js';

/** X-Planar-Signature по контракту: HMAC-SHA256(secret, ровно отправленные байты). */
export const sign = (secret: string, body: string): string =>
  'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

/** Одна попытка: статус ответа; ошибка/таймаут/3xx — throw. Редиректы не выполняются. */
export async function post(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs = Number(process.env.WEBHOOKS_TIMEOUT_MS) || 10_000,
): Promise<number> {
  const u = new URL(url);
  const { address, family } = await safeAddress(u.hostname);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await new Promise<number>((resolve, reject) => {
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request(
        {
          host: u.hostname.replace(/^\[|\]$/g, ''),
          port: u.port || undefined,
          path: u.pathname + u.search,
          method: 'POST',
          headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
          agent: false,
          signal: ac.signal,
          // соединение — на проверенный адрес, без повторного резолва
          lookup: (_h, o, cb) =>
            (o as { all?: boolean }).all
              ? (cb as (e: null, a: unknown) => void)(null, [{ address, family }])
              : cb(null, address, family),
        },
        (res) => {
          res.destroy(); // тело не нужно
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  } catch (e) {
    throw ac.signal.aborted ? new Error('timeout') : e;
  } finally {
    clearTimeout(timer);
  }
}
