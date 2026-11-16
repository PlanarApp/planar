// KB-12: the knowledge block of every AI run prompt (the paths themselves — in run / chat-run / agent / docs-ai tests).
import { afterEach, describe, expect, it } from 'vitest';
import { kbBlock } from '../../../../modules/ai/api/aikb/block.js';

const saved = process.env.PUBLIC_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = saved;
});

describe('kbBlock', () => {
  it('берёт адрес из PUBLIC_URL, без него — локальный', () => {
    process.env.PUBLIC_URL = 'https://kb.example/';
    expect(kbBlock()).toContain('Planar knowledge');
    expect(kbBlock()).toContain('https://kb.example/t/');
    delete process.env.PUBLIC_URL;
    expect(kbBlock()).toContain('http://localhost:5173/t/');
  });
});
