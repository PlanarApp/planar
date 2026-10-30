import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Key from PLANAR_SECRET_KEY (32 bytes base64); missing or wrong length — undefined. */
export function secretKey(): Buffer | undefined {
  const k = Buffer.from(process.env.PLANAR_SECRET_KEY ?? '', 'base64');
  return k.length === 32 ? k : undefined;
}

/** 'v1:' + b64(iv 12) + ':' + b64(tag 16) + ':' + b64(ciphertext) */
export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

export function decrypt(enc: string, key: Buffer): string {
  const [v, iv, tag, data] = enc.split(':');
  if (v !== 'v1' || !iv || !tag || data === undefined) throw new Error('bad token_enc');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
