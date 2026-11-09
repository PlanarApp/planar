import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { domainMutators, uuidv7, type Row } from '@planar/shared';
import { db, registerMutators, replicaState, startSync, stopSync } from '../../sync';
import { favorites } from '../nav';

// PLNRAPP-124: favourites are rows of the replica (favorites), written by favorite.* mutators
const me = uuidv7();
const order = async () =>
  (await db.table<Row<'favorites'>>('favorites').toArray())
    .sort((a, b) => (a.rank < b.rank ? -1 : 1))
    .map((r) => `${r.kind}:${r.refId}`);

beforeAll(() => registerMutators(domainMutators));
beforeEach(async () => {
  await stopSync();
  for (const t of db.tables) await t.clear();
  localStorage.clear();
  replicaState.value = 'empty';
  await startSync({ userId: me, fetch: (() => Promise.reject(new TypeError('offline'))) as never });
});

describe('избранное', () => {
  it('toggle добавляет и снимает по виду и id — строки реплики', async () => {
    favorites.toggle({ kind: 'task', id: 't1', name: 'Задача', to: '/t/PLN-1' });
    await vi.waitFor(() => expect(favorites.has('task', 't1')).toBe(true));
    favorites.toggle({ kind: 'doc', id: 't1', name: 'Док', to: '/m/docs/t1' });
    await vi.waitFor(() => expect(favorites.has('doc', 't1')).toBe(true));
    favorites.toggle({ kind: 'task', id: 't1', name: '', to: '' });
    await vi.waitFor(() => expect(favorites.has('task', 't1')).toBe(false));
    expect(await db.table('favorites').toArray()).toMatchObject([
      { userId: me, kind: 'doc', refId: 't1', name: 'Док', url: '/m/docs/t1' },
    ]);
  });

  it('PLNRAPP-72 reorder: новый порядок показанных, скрытые сохраняют ранг', async () => {
    for (const id of ['a', 'b', 'c', 'gone']) {
      favorites.toggle({ kind: 'task', id, name: id, to: `/t/${id}` });
      await vi.waitFor(() => expect(favorites.has('task', id)).toBe(true));
    }
    favorites.reorder(['task:c', 'task:a', 'task:b']);
    await vi.waitFor(async () =>
      expect((await order()).filter((k) => k !== 'task:gone')).toEqual([
        'task:c',
        'task:a',
        'task:b',
      ]),
    );
  });

  it('старое избранное из localStorage переносится на сервер один раз после bootstrap', async () => {
    localStorage.setItem(
      'planar.favorites',
      JSON.stringify(['p1', 42, null, { kind: 'task', id: 't9', name: 'T', to: '/t/X-9' }]),
    );
    replicaState.value = 'complete';
    await vi.waitFor(async () => expect(await order()).toEqual(['project:p1', 'task:t9']));
    expect(localStorage.getItem('planar.favorites')).toBeNull();
  });
});
