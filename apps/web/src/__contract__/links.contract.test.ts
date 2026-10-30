// @vitest-environment node
// Contract test features (F-links): exports per docs/contracts/features.md.
// Edited only by the features module coordinator.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as links from '../links/index';

const doc = readFileSync(
  new URL('../../../../docs/contracts/features.md', import.meta.url),
  'utf8',
);
const part = doc.split(/^## F-links v\d+\s*$/m)[1]?.split(/^## /m)[0] ?? '';
const web = part.split(/^### /m).find((s) => s.startsWith('Web')) ?? '';
const names = [...web.matchAll(/^\| `(\w+)` \|/gm)].map((r) => r[1]);

describe('F-links: экспорты', () => {
  it('таблица разобрана', () => {
    expect(names).toEqual([
      'useTaskLinks',
      'useBlockedIds',
      'linkTasks',
      'unlinkTasks',
      'BlockedIcon',
    ]);
  });
  it.each(names)('links %s', (n) => {
    expect(
      (links as Record<string, unknown>)[n],
      `links/index.ts не экспортирует ${n}`,
    ).toBeDefined();
  });
});
