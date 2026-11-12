// drizzle applies only migrations newer than the last applied one (by `when`): a smaller `when` is skipped forever
// and /api/health/ready stays «migrations: pending» (PLNRAPP-193: 0059 got Date.now() below 0058's hand-set value).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const journal = JSON.parse(
  readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
) as { entries: { tag: string; when: number }[] };

describe('drizzle journal', () => {
  it('when strictly increases', () => {
    const bad = journal.entries.filter((e, i) => i > 0 && e.when <= journal.entries[i - 1]!.when);
    expect(bad.map((e) => e.tag)).toEqual([]);
  });
});
