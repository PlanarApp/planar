import { isIP } from 'node:net';

/** MAX_UPLOAD_MB: пусто/не задано → 50; нечисло или ≤ 0 → ошибка. */
export function parseMaxUploadMb(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 50;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`MAX_UPLOAD_MB: ожидается число > 0, получено "${raw}"`);
  return n;
}

/** TRUST_PROXY: IP/CIDR через запятую → список для Fastify trustProxy; пусто → []. true/имена → ошибка. */
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
