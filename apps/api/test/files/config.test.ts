import { describe, expect, it } from 'vitest';
import { parseMaxUploadMb } from '../../src/config.js';

describe('parseMaxUploadMb', () => {
  it('пусто или не задано → 50', () => {
    expect(parseMaxUploadMb(undefined)).toBe(50);
    expect(parseMaxUploadMb('')).toBe(50);
  });
  it('число > 0', () => {
    expect(parseMaxUploadMb('10')).toBe(10);
  });
  it('мусор, 0, отрицательное → ошибка', () => {
    for (const v of ['abc', '0', '-5', 'Infinity'])
      expect(() => parseMaxUploadMb(v)).toThrow(/MAX_UPLOAD_MB/);
  });
});
