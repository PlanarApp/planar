// @vitest-environment node
import 'fake-indexeddb/auto';
import { uuidv7 } from '@planar/shared';
import { txContractSuite } from '../../../../../packages/shared/test/tx-contract';
import { PlanarDB } from '../db';
import { DexieTx } from '../dexie-tx';

txContractSuite('DexieTx', async () => {
  const db = new PlanarDB('tx-' + uuidv7());
  const spaceId = uuidv7();
  const now = '2026-10-22T10:00:00.000Z';
  await db.table('spaces').put({
    id: spaceId,
    name: 'S',
    description: null,
    color: null,
    icon: null,
    leadId: null,
    rank: 'a0',
    createdBy: uuidv7(),
    createdAt: now,
    updatedAt: now,
  });
  return { tx: new DexieTx(db), spaceId, done: async () => void (await db.delete()) };
});
