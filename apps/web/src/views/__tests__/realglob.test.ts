import { describe, expect, it } from 'vitest';
import { buildViewTabs, viewLoaders } from '..';

describe('views:real-glob', () => {
  it('views:real-glob вкладки из настоящих ключей import.meta.glob', () => {
    const keys = buildViewTabs(viewLoaders(), []).map((t) => t.key);
    expect(keys.slice(0, 2)).toEqual(['list', 'board']);
  });
});
