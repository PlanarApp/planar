import { test } from '@playwright/test';
import { Client } from '../../../lib';
import { ctxFor, projects, save } from './lib';

// Lower bound: plain IndexedDB without Dexie/Vue — how much it costs to read/write §7 data in Chromium.
test('idb-micro', async ({ browser }) => {
  const admin = await Client.login('admin');
  const { big, counts } = await projects(admin);
  const ctx = await ctxFor(browser, admin, false);
  const page = await ctx.newPage();
  await page.goto(`/p/${big.id}/list`);
  await page.waitForSelector('[role=row][data-task]');
  await page.waitForTimeout(3000);
  const r = await page.evaluate(async (pid) => {
    const db: IDBDatabase = await new Promise((res) => {
      const q = indexedDB.open('planar');
      q.onsuccess = () => res(q.result);
    });
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)]!;
    const timeIt = async (fn: () => Promise<unknown>, n = 7) => {
      const t: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        await fn();
        t.push(performance.now() - t0);
        await new Promise((r) => setTimeout(r, 30));
      }
      return +med(t).toFixed(1);
    };
    const req = <T>(r: IDBRequest<T>) =>
      new Promise<T>((res) => ((r.onsuccess = () => res(r.result)), void 0));
    const done = (tx: IDBTransaction) => new Promise<void>((res) => (tx.oncomplete = () => res()));
    const out: Record<string, unknown> = {};
    for (const t of ['tasks', 'taskAssignees', 'taskLabels', 'statuses', 'users']) {
      const n = await req(db.transaction(t).objectStore(t).count());
      const rows: Record<string, unknown>[] = await req(db.transaction(t).objectStore(t).getAll());
      out[t] = {
        rows: n,
        avg_json_bytes: rows.length ? Math.round(JSON.stringify(rows).length / rows.length) : 0,
        getAll_ms: await timeIt(async () => {
          const tx = db.transaction(t);
          const rq = tx.objectStore(t).getAll();
          await req(rq);
          await done(tx);
        }),
      };
    }
    out.tasks_by_project_index_ms = await timeIt(async () => {
      const tx = db.transaction('tasks');
      await req(tx.objectStore('tasks').index('projectId').getAll(pid));
      await done(tx);
    });
    out.assignees_cursor_ms = await timeIt(async () => {
      const tx = db.transaction('taskAssignees');
      await new Promise<void>((res) => {
        const c = tx.objectStore('taskAssignees').openCursor();
        c.onsuccess = () => (c.result ? c.result.continue() : res());
      });
    }, 3);
    out.three_tables_parallel_ms = await timeIt(async () => {
      const tx = db.transaction(['tasks', 'taskAssignees', 'taskLabels']);
      await Promise.all(
        ['tasks', 'taskAssignees', 'taskLabels'].map((t) => req(tx.objectStore(t).getAll())),
      );
      await done(tx);
    });
    // write: put 2000 tasks rows in one transaction (copies with new ids), then delete
    const sample: Record<string, unknown>[] = await req(
      db.transaction('tasks').objectStore('tasks').getAll(),
    );
    const copy = (n: number, tag: string) =>
      sample.slice(0, n).map((x, i) => ({ ...x, id: `${tag}-${i}` }));
    out.put_2000_tasks_ms = await timeIt(async () => {
      const tx = db.transaction('tasks', 'readwrite');
      const st = tx.objectStore('tasks');
      for (const x of copy(2000, 'zz')) st.put(x);
      await done(tx);
    }, 3);
    out.put_2000_tasks_cached_clone_ms = out.put_2000_tasks_ms;
    const tx = db.transaction('tasks', 'readwrite');
    for (let i = 0; i < 2000; i++) tx.objectStore('tasks').delete(`zz-${i}`);
    await done(tx);
    // write cost: 10000 tasks rows in one transaction into a clean DB — with and without replica indexes
    const idxNames = [...db.transaction('tasks').objectStore('tasks').indexNames];
    const idxDefs = idxNames.map((n) => {
      const ix = db.transaction('tasks').objectStore('tasks').index(n);
      return [n, ix.keyPath, ix.multiEntry] as const;
    });
    const all: Record<string, unknown>[] = await req(
      db.transaction('tasks').objectStore('tasks').getAll(),
    );
    const writeTest = async (name: string, withIdx: boolean) => {
      await new Promise((res) => {
        const d = indexedDB.deleteDatabase(name);
        d.onsuccess = d.onerror = () => res(null);
      });
      const tdb: IDBDatabase = await new Promise((res) => {
        const q = indexedDB.open(name, 1);
        q.onupgradeneeded = () => {
          const st = q.result.createObjectStore('tasks', { keyPath: 'id' });
          if (withIdx)
            for (const [n, kp, me] of idxDefs) st.createIndex(n, kp as string, { multiEntry: me });
        };
        q.onsuccess = () => res(q.result);
      });
      const t0 = performance.now();
      const tx = tdb.transaction('tasks', 'readwrite');
      const st = tx.objectStore('tasks');
      for (const x of all) st.put(x);
      await done(tx);
      const ms = performance.now() - t0;
      tdb.close();
      return +ms.toFixed(0);
    };
    out.write_10000_tasks_with_indexes_ms = await writeTest('wb17tmp1', true);
    out.write_10000_tasks_no_indexes_ms = await writeTest('wb17tmp2', false);
    out.task_indexes = idxNames;
    return out;
  }, big.id);
  console.log('idb-micro', JSON.stringify({ counts, ...r }));
  save('idb-micro', { counts, ...r });
  await ctx.close();
});
