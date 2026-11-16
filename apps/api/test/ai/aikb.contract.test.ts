import { describe, expect, it } from 'vitest';

// aikb-section v1 (docs/contracts/aikb.md): the shape of every file in modules/ai/api/aikb/sections
const files = import.meta.glob<{ section: { id: string; title: string; body: string } }>(
  '../../../../modules/ai/api/aikb/sections/*.ts',
  { eager: true },
);

describe('aikb-section v1', () => {
  it('sections dir is readable', () => {
    expect(typeof files).toBe('object');
  });
  it.each(Object.entries(files))('%s', (path, m) => {
    const id = path.split('/').pop()!.replace(/\.ts$/, '');
    expect(m.section.id).toBe(id);
    expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(m.section.title.length).toBeGreaterThan(0);
    expect(m.section.body.length).toBeGreaterThan(0);
    expect(m.section.body).not.toMatch(/planarhq\.com/);
  });
});
