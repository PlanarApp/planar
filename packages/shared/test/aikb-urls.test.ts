import { describe, expect, it } from 'vitest';
import { appUrl } from '../src/index.js';
import { cases } from '../src/aikb/samples.js';

const B = 'https://pl.example.com';

describe('aikb-urls', () => {
  it.each(cases)('%j', (t, path) => expect(appUrl(B, t)).toBe(B + path));
  it('хвостовой / базы убирается, id экранируется', () => {
    expect(appUrl(`${B}//`, { kind: 'task', key: 'a/b' })).toBe(`${B}/t/a%2Fb`);
  });
});
