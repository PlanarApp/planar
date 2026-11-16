import { describe, expect, it } from 'vitest';
import { searchDocsSite } from '../../src/mcp/tools-docs-site.js';

describe('search_docs_site (PLNRAPP-267)', () => {
  it('поиск: ≤ 10 совпадений с фрагментом ≤ 300, по умолчанию ru', () => {
    const r = searchDocsSite({ query: 'токен' }) as { section: string; fragment: string }[];
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(10);
    for (const x of r) expect(x.fragment.length).toBeLessThanOrEqual(300);
  });

  it('раздел по id: текст одного раздела; en; неизвестный — not_found', () => {
    const [hit] = searchDocsSite({ query: 'token', lang: 'en' }) as { section: string }[];
    const s = searchDocsSite({ query: 'x', lang: 'en', section: hit!.section }) as {
      text: string;
    };
    expect(s.text.toLowerCase()).toContain('token');
    expect(() => searchDocsSite({ query: 'x', section: 'нет.md#нет' })).toThrow();
  });
});
