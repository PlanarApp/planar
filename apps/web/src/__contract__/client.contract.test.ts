// @vitest-environment node
// Контрактный тест web (C-client): экспорты клиента синхронизации по docs/contracts/web.md.
// Правит только координатор модуля web.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as client from '../sync/index';

const doc = readFileSync(new URL('../../../../docs/contracts/web.md', import.meta.url), 'utf8');
const part = doc.split(/^## C-client v\d+\s*$/m)[1] ?? '';
const exportsTable = part.split(/^### /m).find((s) => s.startsWith('Экспорты')) ?? '';
const names = [...exportsTable.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]);

describe('C-client: экспорты', () => {
  it('список из контракта', () => {
    expect(names).toEqual([
      'db',
      'startSync',
      'stopSync',
      'useQuery',
      'mutate',
      'registerMutators',
      'syncState',
      'onMutationError',
      'onUnauthorized',
      'newId',
      'rankBetween',
    ]);
  });
  it.each(names)('экспорт %s', (n) => {
    expect(
      (client as Record<string, unknown>)[n],
      `sync/index.ts не экспортирует ${n}`,
    ).toBeDefined();
  });
  it('rankBetween упорядочен', () => {
    const a = client.rankBetween(null, null);
    const b = client.rankBetween(a, null);
    const m = client.rankBetween(a, b);
    expect(a < m && m < b).toBe(true);
  });
  it('newId — uuidv7', () => {
    expect(client.newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
  it('mutate неизвестного мутатора → invalid_args', async () => {
    await expect(client.mutate('no.such', {})).rejects.toMatchObject({ code: 'invalid_args' });
  });
});
