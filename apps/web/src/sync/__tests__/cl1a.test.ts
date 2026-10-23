import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { PlanarDB } from '../db';
import { createClient } from '../client';
import { FakeWebSocket } from './fake-server';
import { setup, stopAll } from './helpers';
import { moduleIndexes, moduleMutators } from '../../modules/shared';

afterEach(async () => {
  await stopAll();
  FakeWebSocket.reset();
});

describe('cl1a: typing', () => {
  it('cl1a: sendTyping шлёт кадр по открытому WS, onTyping получает чужие, отписка работает', async () => {
    const { mk, start } = setup();
    const c = mk();
    await start(c, true);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    const id = uuidv7();
    c.sendTyping('chatMessages', id);
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ t: 'typing', entity: 'chatMessages', id });
    const got: unknown[] = [];
    const off = c.onTyping((e) => got.push(e));
    const msg = { t: 'typing', entity: 'chatMessages', id, userId: uuidv7() };
    ws.onmessage?.({ data: JSON.stringify(msg) });
    expect(got).toEqual([{ entity: msg.entity, id, userId: msg.userId }]);
    off();
    ws.onmessage?.({ data: JSON.stringify(msg) });
    expect(got).toHaveLength(1);
  });

  it('cl1a: sendTyping без WS ничего не делает и не бросает', async () => {
    const { mk, start } = setup();
    const c = mk();
    expect(() => c.sendTyping('x', 'y')).not.toThrow();
    await start(c, false);
    expect(() => c.sendTyping('x', 'y')).not.toThrow();
  });
});

describe('cl1a: модули в клиенте', () => {
  it('cl1a: таблица docsPages в Dexie; mutate docs.page.create применяется локально', async () => {
    expect(moduleIndexes.docsPages).toEqual(expect.arrayContaining(['spaceId', 'parentId']));
    const mdb = new PlanarDB('cl1a-' + uuidv7(), moduleIndexes);
    const c = createClient(mdb);
    c.registerMutators(moduleMutators);
    const userId = uuidv7();
    await c.startSync({
      userId,
      fetch: (() => Promise.reject(new TypeError('offline'))) as never,
    });
    expect(mdb.tables.map((t) => t.name)).toContain('docsPages');
    const spaceId = uuidv7();
    await mdb.table('spaceMembers').put({
      id: uuidv7(),
      spaceId,
      userId,
      role: 'member',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const id = uuidv7();
    await c.mutate('docs.page.create', { id, spaceId, rank: 'a0', title: 'Привет' });
    expect(await mdb.table('docsPages').get(id)).toMatchObject({ title: 'Привет', spaceId });
    await c.stopSync();
  });
});
