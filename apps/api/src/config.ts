import { isIP } from 'node:net';

/** MAX_UPLOAD_MB: empty/unset → 50; not a number or ≤ 0 → error. */
export function parseMaxUploadMb(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 50;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`MAX_UPLOAD_MB: ожидается число > 0, получено "${raw}"`);
  return n;
}

/** positive integer env var; empty/unset → def. */
function parsePosInt(name: string, raw: string | undefined, def: number): number {
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`${name}: ожидается целое ≥ 1, получено "${raw}"`);
  return n;
}

/** DB_POOL_MAX: empty/unset → 10; not an integer ≥ 1 → error. */
export const parseDbPoolMax = (raw: string | undefined): number =>
  parsePosInt('DB_POOL_MAX', raw, 10);

/** DEMO_RESET_HOURS: empty/unset → 24; not an integer ≥ 1 → error. */
export const parseDemoResetHours = (raw: string | undefined): number =>
  parsePosInt('DEMO_RESET_HOURS', raw, 24);

/** DEMO_MODE: true/false (case-insensitive); empty/unset → false; anything else → error. */
export function parseDemoMode(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'false') return false;
  if (v === 'true') return true;
  throw new Error(`DEMO_MODE: ожидается true или false, получено "${raw}"`);
}

/** TRUST_PROXY: comma-separated IP/CIDR → list for Fastify trustProxy; empty → []. true/names → error. */
export function parseTrustProxy(raw: string | undefined): string[] {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const item of list) {
    const [ip, mask, ...rest] = item.split('/');
    const max = isIP(ip!) === 4 ? 32 : 128;
    const okMask = mask === undefined || (/^\d+$/.test(mask) && Number(mask) <= max);
    if (!isIP(ip!) || !okMask || rest.length)
      throw new Error(`TRUST_PROXY: ожидается список IP/CIDR, получено "${item}"`);
  }
  return list;
}
