// Контрактный тест work (C-modules v7): перечень значений SDK @planar/web/modules. Правит только координатор work.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as sdk from '../modules/sdk';
import * as sync from '../sync';

const doc = readFileSync(resolve(__dirname, '../../../../docs/contracts/work-api.md'), 'utf8');
const list = (name: string) =>
  (new RegExp('^```text sdk-exports=' + name + '\\n([\\s\\S]*?)^```', 'm').exec(doc)?.[1] ?? '')
    .split(/\s+/)
    .filter(Boolean);

describe('C-modules v7: SDK', () => {
  it('перечни есть в контракте', () => {
    expect(list('required').length).toBeGreaterThan(10);
    expect(list('with-sync').length).toBeGreaterThan(0);
  });
  it.each(list('required'))('SDK экспортирует %s', (n) => {
    expect((sdk as Record<string, unknown>)[n], n).toBeDefined();
  });
  it.each(list('with-sync'))('SDK реэкспортирует %s, если его даёт клиент', (n) => {
    if ((sync as Record<string, unknown>)[n] === undefined) return;
    expect((sdk as Record<string, unknown>)[n], n).toBeDefined();
  });
});
