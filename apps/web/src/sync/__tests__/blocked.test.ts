import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { db, dbBlocked } from '../index';

const openRaw = (version: number) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('planar', version);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

// a frozen background tab keeps the connection and ignores versionchange: the upgrade waits, the screen says why
it('replica upgrade blocked by another connection → dbBlocked until it closes', async () => {
  const frozen = await openRaw(1);
  const opening = db.open();
  await expect.poll(() => dbBlocked.value).toBe(true);
  frozen.close();
  await opening;
  expect(dbBlocked.value).toBe(false);
  db.close();
});
