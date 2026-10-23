// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { uuidv7 } from '@planar/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildSchema, PlanarDB } from '../db';

describe('dexie-v2', () => {
  it('dexie-v2: реплика v1 открывается в v2 без потери данных и без SchemaDiff', async () => {
    const name = 'v2-' + uuidv7();
    const warn = vi.spyOn(console, 'warn');
    const old = new Dexie(name);
    old.version(1).stores(buildSchema({}, ['fieldDefs', 'taskLinks']));
    const id = uuidv7();
    await old.table('tasks').put({ id, title: 'T' });
    await old.table('_meta').put({ key: 'cursor', value: 5 });
    await old.table('_queue').add({ name: 'x', args: {}, createdAt: 'n' });
    old.close();

    const db = new PlanarDB(name);
    expect(await db.table('tasks').get(id)).toMatchObject({ title: 'T' });
    expect(await db.table('_meta').get('cursor')).toMatchObject({ value: 5 });
    expect(await db.table('_queue').count()).toBe(1);
    expect(await db.table('fieldDefs').count()).toBe(0);
    expect(await db.table('taskLinks').count()).toBe(0);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('SchemaDiff'))).toEqual([]);
    warn.mockRestore();
    await db.delete();
  });

  it('dexie-v2: новая база имеет версию 2 с fieldDefs и taskLinks', async () => {
    const db = new PlanarDB('v2n-' + uuidv7());
    await db.open();
    expect(db.verno).toBe(2);
    expect(db.tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['fieldDefs', 'taskLinks']),
    );
    await db.delete();
  });
});
