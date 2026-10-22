import { afterAll } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { uuidv7 } from '@planar/shared';
import { txContractSuite } from '../../../../packages/shared/test/tx-contract.js';
import * as schema from '../../src/db/schema.js';
import { ServerTx } from '../../src/sync/server-tx.js';
import { testDbUrl } from '../db.js';
import { mkUser, newDb } from './helpers.js';

const clients: pg.Client[] = [];
const adminDb = newDb();
const userId = await mkUser(adminDb, 'owner');
afterAll(async () => {
  await Promise.all(clients.map((c) => c.end()));
  await adminDb.$client.end();
});

txContractSuite('ServerTx', async () => {
  const client = new pg.Client({ connectionString: testDbUrl() });
  await client.connect();
  clients.push(client);
  await client.query('BEGIN');
  const q = drizzle({ client, schema, casing: 'snake_case' });
  const spaceId = uuidv7();
  await q.insert(schema.spaces).values({ id: spaceId, name: 'S', rank: 'a0', createdBy: userId });
  return {
    tx: ServerTx.asSystem(q, { userId }),
    spaceId,
    done: async () => {
      await client.query('ROLLBACK');
    },
  };
});
