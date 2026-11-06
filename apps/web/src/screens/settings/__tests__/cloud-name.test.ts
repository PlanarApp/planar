// PLNRAPP-92: the instance name typed for import/reset/delete — spaces and case don't block the button
import { describe, expect, it } from 'vitest';
import { nameTyped } from '../cloud';

describe('nameTyped', () => {
  it('ignores surrounding spaces and case', () => {
    expect(nameTyped(' Acme ', 'acme')).toBe(true);
    expect(nameTyped('acme', 'acme')).toBe(true);
  });
  it('rejects another name and an unloaded state', () => {
    expect(nameTyped('acm', 'acme')).toBe(false);
    expect(nameTyped('', '')).toBe(false);
  });
});
