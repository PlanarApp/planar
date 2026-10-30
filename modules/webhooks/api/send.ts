import { createHmac } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { isDemo } from '@planar/server-kit';
import { safeAddress } from './ssrf.js';

/** X-Planar-Signature per the contract: HMAC-SHA256(secret, exactly the bytes sent). */
export const sign = (secret: string, body: string): string =>
  'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

/** One attempt: the response status; an error/timeout/3xx — throw. Redirects are not followed. */
export async function post(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs = Number(process.env.WEBHOOKS_TIMEOUT_MS) || 10_000,
): Promise<number> {
  if (isDemo()) return 200; // demo: no outgoing requests
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
          // the connection is to the verified address, without re-resolving
          lookup: (_h, o, cb) =>
            (o as { all?: boolean }).all
              ? (cb as (e: null, a: unknown) => void)(null, [{ address, family }])
              : cb(null, address, family),
        },
        (res) => {
          res.destroy(); // the body is not needed
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
