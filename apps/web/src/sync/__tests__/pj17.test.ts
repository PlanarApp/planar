// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { uuidv7 } from '@planar/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSchema, PlanarDB } from '../db';

const EXTRA = { sprints: ['spaceId'] };
const store: Record<string, string> = {};
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => void (store[k] = v),
};

afterEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

/** Индексы таблицы в самой базе IndexedDB (а не в объявленной схеме Dexie). */
const realIndexes = (name: string, table: string) =>
  new Promise<string[]>((resolve, reject) => {
    const r = indexedDB.open(name);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const idb = r.result;
      const names = idb.objectStoreNames.contains(table)
        ? [...idb.transaction(table).objectStore(table).indexNames]
        : [];
      idb.close();
      resolve(names);
    };
  });

const NEW_TABLES = ['projectMembers', 'projectStatuses', 'projectLabels', 'projectModules'];
const OLD_INDEXES = ['statuses.projectId', 'labels.projectId'];

async function oldReplica(name: string, sig?: string) {
  const old = new Dexie(name);
  old.version(4).stores(buildSchema(EXTRA, NEW_TABLES, OLD_INDEXES));
  await old.table('_meta').put({ key: 'cursor', value: 5 });
  old.close();
  if (sig !== undefined) store['planar.dexieSchema.' + name] = JSON.stringify({ sig, v: 4 });
}

describe('pj17: реплика до обновления', () => {
  it('pj17: старая подпись -> схема обновляется, данные на месте', async () => {
    const name = 'pj17a-' + uuidv7();
    await oldReplica(name, 'sprints:spaceId');
    const db = new PlanarDB(name, EXTRA);
    await db.open();
    expect(await realIndexes(name, 'statuses')).toContain('projectId');
    expect(await realIndexes(name, 'projectMembers')).toContain('userId');
    expect(await db.table('_meta').get('cursor')).toMatchObject({ value: 5 });
    await db.delete();
  });

  it('pj17: подписи в localStorage нет (очищен отдельно от IndexedDB) -> схема обновляется', async () => {
    const name = 'pj17b-' + uuidv7();
    await oldReplica(name);
    const db = new PlanarDB(name, EXTRA);
    await db.open();
    expect(await realIndexes(name, 'statuses')).toContain('projectId');
    expect(await realIndexes(name, 'projectMembers')).toContain('userId');
    await db.delete();
  });

  it('pj17: набор сущностей тот же, индексы ядра изменились -> схема обновляется', async () => {
    const name = 'pj17c-' + uuidv7();
    const first = new PlanarDB(name, EXTRA);
    await first.open();
    const v = first.verno;
    first.close();
    await Dexie.delete(name);
    const old = new Dexie(name);
    old.version(v).stores(buildSchema(EXTRA, [], OLD_INDEXES));
    old.close();
    const db = new PlanarDB(name, EXTRA);
    await db.open();
    expect(await realIndexes(name, 'statuses')).toContain('projectId');
    await db.delete();
  });
});
