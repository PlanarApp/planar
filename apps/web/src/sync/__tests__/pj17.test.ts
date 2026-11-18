// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { uuidv7 } from '@planar/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSchema, dataSig, PlanarDB, schemaVersion } from '../db';

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

describe('PLNRAPP-484: схема реплики v4 — _held, tasks.createdBy', () => {
  /** реплика прошлой сборки с модулями: без _held и индекса createdBy, подпись — в старом формате */
  async function preHeldReplica(name: string) {
    const old = new Dexie(name);
    old.version(7).stores(buildSchema(EXTRA, ['_held'], ['tasks.createdBy']));
    await old.table('_meta').put({ key: 'cursor', value: 5 });
    await old.table('tasks').put({ id: 't1', createdBy: 'u1' });
    old.close();
    store['planar.dexieSchema.' + name] = JSON.stringify({ sig: 'core;sprints:spaceId', v: 7 });
  }

  it('индекс ядра при установленных модулях поднимает версию Dexie, данные на месте', async () => {
    const name = 'pln484a-' + uuidv7();
    await preHeldReplica(name);
    const db = new PlanarDB(name, EXTRA);
    await db.open();
    expect(db.verno).toBe(8);
    expect(await realIndexes(name, 'tasks')).toContain('createdBy');
    expect(await realIndexes(name, '_held')).toContain('accessedAt');
    expect(await db.table('_meta').get('cursor')).toMatchObject({ value: 5 });
    expect((await db.table('tasks').where('createdBy').equals('u1').toArray()).length).toBe(1);
    db.close();
    // та же сборка — версия не растёт
    const again = new PlanarDB(name, EXTRA);
    await again.open();
    expect(again.verno).toBe(8);
    await again.delete();
  });

  it('смена индекса ядра меняет версию при той же подписи модулей', () => {
    const name = 'pln484b-' + uuidv7();
    const v = schemaVersion(name, EXTRA);
    expect(v).toBe(5);
    expect(schemaVersion(name, EXTRA)).toBe(v);
    const key = 'planar.dexieSchema.' + name;
    const old = JSON.parse(store[key]!) as { sig: string; v: number };
    // подпись сборки, где у задач ещё не было индекса createdBy
    old.sig = JSON.stringify(buildSchema(EXTRA, [], ['tasks.createdBy']));
    store[key] = JSON.stringify(old);
    expect(schemaVersion(name, EXTRA)).toBe(v + 1);
  });

  it('без модулей реплика v3 обновляется до v4', async () => {
    const name = 'pln484c-' + uuidv7();
    const old = new Dexie(name);
    old.version(3).stores(buildSchema({}, ['_held'], ['tasks.createdBy']));
    await old.table('tasks').put({ id: 't1', createdBy: 'u1' });
    old.close();
    const db = new PlanarDB(name);
    await db.open();
    expect(db.verno).toBe(4);
    expect(await db.table('tasks').where('createdBy').equals('u1').count()).toBe(1);
    await db._held.put({ taskId: 't1', loadedAt: 'a', accessedAt: 'b' });
    expect(await db._held.orderBy('accessedAt').primaryKeys()).toEqual(['t1']);
    await db.delete();
  });

  it('подпись данных не зависит от индексов и служебных таблиц, старый формат приводится к ней', () => {
    const db = new PlanarDB('pln484d-' + uuidv7());
    const legacy = db.tables
      .filter((t) => t.name !== '_held')
      .map(
        (t) => `${t.name}:${t.schema.indexes.map((i) => i.name).filter((i) => i !== 'createdBy')}`,
      )
      .join(';');
    expect(dataSig(legacy)).toBe(db.schemaSig());
    expect(dataSig(legacy.replace(/(^|;)labels:[^;]*/, ''))).not.toBe(db.schemaSig());
  });
});
