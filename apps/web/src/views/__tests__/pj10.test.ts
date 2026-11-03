// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// jsdom has no layout: we only pin the class that makes the e2e (e2e/web/pj10.spec.ts) pass
describe('PJ-10: вёрстка «Моей работы» на мобильном', () => {
  it('PJ-10: вкладки группы — containing block для sr-only, иначе они раздвигают документ', () => {
    const src = readFileSync(new URL('../../screens/GroupScreen.vue', import.meta.url), 'utf8');
    const nav = /<nav[^>]*data-testid="group-tabs"[^>]*class="([^"]*)"/s.exec(src)?.[1] ?? '';
    expect(nav).toContain('overflow-x-auto');
    expect(nav.split(' ')).toContain('relative');
  });
});
