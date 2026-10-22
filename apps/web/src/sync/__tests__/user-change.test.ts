import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { createClient } from '../client';
import { PlanarDB } from '../db';
import { label, stopAll } from './helpers';

afterEach(stopAll);
const offline = (() => Promise.reject(new TypeError('offline'))) as typeof fetch;

describe('session: C-client v2', () => {
  it('session: смена пользователя чистит реплику, тот же — нет; clearLocal чистит всё', async () => {
    const db = new PlanarDB('uc-' + uuidv7());
    const c = createClient(db);
    await c.startSync({ userId: 'A', fetch: offline });
    await db.table('labels').put(label('x'));
    await db._queue.add({ name: 'n', args: {}, createdAt: '' });
    const clientId = (await db._meta.get('clientId'))!.value;
    await c.startSync({ userId: 'A', fetch: offline });
    expect(await db.table('labels').count()).toBe(1);
    await c.startSync({ userId: 'B', fetch: offline });
    expect(await db.table('labels').count()).toBe(0);
    expect(await db._queue.count()).toBe(0);
    expect((await db._meta.get('clientId'))!.value).not.toBe(clientId);
    await db.table('labels').put(label('y'));
    await c.clearLocal();
    expect(await db.table('labels').count()).toBe(0);
    expect(c.syncState.value.pending).toBe(0);
    await c.stopSync();
  });
});
