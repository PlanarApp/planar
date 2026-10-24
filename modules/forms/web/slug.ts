const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** 16 символов [a-z0-9] из crypto.getRandomValues (255 % 36 ≠ 0 → отбрасываем хвост, без смещения). */
export function genSlug(): string {
  let s = '';
  while (s.length < 16) {
    for (const b of crypto.getRandomValues(new Uint8Array(32)))
      if (b < 252 && s.length < 16) s += ALPHABET[b % 36];
  }
  return s;
}
