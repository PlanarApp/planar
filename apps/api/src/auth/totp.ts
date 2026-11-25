import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// TOTP per RFC 6238: SHA-1, 6 digits, 30-second step — what every authenticator app understands
const STEP = 30;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf: Buffer): string {
  let bits = 0;
  let v = 0;
  let out = '';
  for (const b of buf) {
    v = (v << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(v >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits ? out + B32[(v << (5 - bits)) & 31] : out;
}

function unbase32(s: string): Buffer {
  let bits = 0;
  let v = 0;
  const out: number[] = [];
  for (const c of s) {
    v = (v << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32(randomBytes(20));

export function totpCode(secret: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Accepted time step (±1 step for clock drift) or null; steps ≤ lastStep are rejected (no replay). */
export function verifyTotp(
  secret: string,
  code: string,
  lastStep: number | null,
  now = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const cur = Math.floor(now / 1000 / STEP);
  for (const step of [cur - 1, cur, cur + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

export const totpUri = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;

/** 10 one-time codes like 3f9a-c021; the DB keeps only sha256 of the normalized code. */
export const newRecoveryCodes = () =>
  Array.from({ length: 10 }, () =>
    randomBytes(4)
      .toString('hex')
      .replace(/^(.{4})/, '$1-'),
  );

export const hashRecovery = (code: string) =>
  createHash('sha256')
    .update(code.toLowerCase().replace(/[^0-9a-f]/g, ''))
    .digest('hex');
