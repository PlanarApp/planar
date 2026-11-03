import { expect, test } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

// PJ-17: a client whose replica was made before the update (space-level statuses without projectId, a current cursor,
// the old schema version) catches up by itself, without clearing the site data.
test('PJ-17: реплика до обновления догоняет состояние без очистки данных сайта', async ({
  browser,
}) => {
  const f = await fixture(['PJ17 первая', 'PJ17 вторая']);
  const page = await loginAs(browser, 'admin');
  await page.goto(`/p/${f.projectId}/list`);
  await expect(page.getByText('PJ17 первая').first()).toBeVisible();

  // an "old" replica: schema version 4 without the PJ-1/3/11 tables, a current cursor (the old build bootstrapped after the server update), no tasks
  await page.evaluate(async () => {
    const open = (name: string, v?: number, up?: (db: IDBDatabase) => void) =>
      new Promise<IDBDatabase>((res, rej) => {
        const r = v ? indexedDB.open(name, v) : indexedDB.open(name);
        r.onupgradeneeded = () => up?.(r.result);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const cur = await open('planar');
    const meta = await new Promise<{ key: string; value: unknown }[]>((res) => {
      const q = cur.transaction('_meta').objectStore('_meta').getAll();
      q.onsuccess = () => res(q.result);
    });
    cur.close();
    await new Promise((res) => {
      const d = indexedDB.deleteDatabase('planar');
      d.onsuccess = d.onerror = d.onblocked = () => res(null);
    });
    const old = await open('planar', 40, (db) => {
      db.createObjectStore('_meta', { keyPath: 'key' });
      db.createObjectStore('_queue', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('statuses', { keyPath: 'id' }).createIndex('spaceId', 'spaceId');
    });
    await new Promise((res) => {
      const tx = old.transaction(['_meta', 'statuses'], 'readwrite');
      for (const m of meta) if (m.key !== 'schema') tx.objectStore('_meta').put(m); // the cursor stays current
      tx.objectStore('statuses').put({ id: 'old-status', spaceId: 'old-space', name: 'Old' });
      tx.oncomplete = () => res(null);
    });
    old.close();
    localStorage.setItem('planar.dexieSchema.planar', JSON.stringify({ sig: 'old', v: 4 }));
  });

  await page.goto(`/p/${f.projectId}/list`);
  // reload = full bootstrap of a rebuilt replica; on a loaded host it takes longer than the default 15s
  await expect(page.getByText('PJ17 первая').first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('PJ17 вторая').first()).toBeVisible({ timeout: 45_000 });
  // the new schema is in place: the replica has the post-update tables
  const tables = await page.evaluate(
    () =>
      new Promise<string[]>((res) => {
        const r = indexedDB.open('planar');
        r.onsuccess = () => {
          res([...r.result.objectStoreNames]);
          r.result.close();
        };
      }),
  );
  expect(tables).toContain('projectMembers');
});
