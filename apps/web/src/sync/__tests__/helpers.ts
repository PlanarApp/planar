import 'fake-indexeddb/auto';
import { entitySchemas, uuidv7, type MutatorDef } from '../shared';
import { createClient } from '../client';
import { PlanarDB } from '../db';
import { FakeServer, FakeWebSocket } from './fake-server';

export const NOW = '2026-10-22T10:00:00.000Z';
export const SPACE = uuidv7();

export const testMutators: MutatorDef[] = [
  {
    name: 'test.label.put',
    args: entitySchemas.labels.pick({ id: true, spaceId: true, name: true, color: true }),
    run: async (tx, a, ctx) => {
      const x = a as { id: string; spaceId: string; name: string; color: string };
      await tx.put('labels', { ...x, createdAt: ctx.now, updatedAt: ctx.now });
    },
  },
  {
    name: 'test.label.rename',
    args: entitySchemas.labels.pick({ id: true, name: true }),
    run: async (tx, a, ctx) => {
      const x = a as { id: string; name: string };
      await tx.patch('labels', x.id, { name: x.name, updatedAt: ctx.now });
    },
  },
  {
    name: 'test.task.title',
    args: entitySchemas.tasks.pick({ id: true, title: true }),
    run: async (tx, a, ctx) => {
      const x = a as { id: string; title: string };
      await tx.patch('tasks', x.id, { title: x.title, updatedAt: ctx.now });
    },
  },
];

export const label = (name: string, id = uuidv7()) => ({
  id,
  spaceId: SPACE,
  name,
  color: '#fff',
  createdAt: NOW,
  updatedAt: NOW,
});

const live: ReturnType<typeof createClient>[] = [];
export const stopAll = () => Promise.all(live.splice(0).map((c) => c.stopSync()));

export function setup(server = new FakeServer(testMutators), dbName = 'db-' + uuidv7()) {
  const db = new PlanarDB(dbName);
  const mk = () => {
    const c = createClient(db);
    c.registerMutators(testMutators);
    live.push(c);
    return c;
  };
  const start = (c: ReturnType<typeof mk>, ws = false) =>
    c.startSync({
      userId: uuidv7(),
      baseUrl: 'http://test',
      fetch: server.fetch as typeof fetch,
      WebSocket: ws ? (FakeWebSocket as unknown as typeof WebSocket) : undefined,
    });
  return { server, db, mk, start, dbName };
}

export const labels = (db: PlanarDB) => db.table('labels').toArray();
