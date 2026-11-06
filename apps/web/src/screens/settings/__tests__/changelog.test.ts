import { describe, expect, it } from 'vitest';
import { parseChangelog, releases } from '../changelog';

describe('about:changelog (PLNRAPP-116)', () => {
  it('версии новые сверху, без Unreleased, пункты по разделам', () => {
    const md = [
      '# Changelog',
      '## [Unreleased]',
      '- draft',
      '## [0.2.0] - 2026-11-05',
      '### Added',
      '- `start.sh` script',
      '### Fixed',
      '- bug',
      '## [0.1.0] - 2026-10-30 (public beta)',
      '- no section',
      '[0.2.0]: https://example.com',
    ].join('\n');
    expect(parseChangelog(md)).toEqual([
      {
        version: '0.2.0',
        date: '2026-11-05',
        sections: [
          { title: 'Added', items: ['start.sh script'] },
          { title: 'Fixed', items: ['bug'] },
        ],
      },
      { version: '0.1.0', date: '2026-10-30', sections: [] },
    ]);
  });
  it('настоящий CHANGELOG.md читается', () => {
    expect(releases[0]?.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
