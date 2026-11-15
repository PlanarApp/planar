import { mkdirSync, writeFileSync } from 'node:fs';
import { test, type Browser, type Page } from '@playwright/test';
import { BASE, Client } from '../../lib';

// PLNRAPP-247: UI on a large import (Plane export: 4206 tasks, 12 projects, ~10k comments) — runs only with BIG_PERF=1.
test.skip(!process.env.BIG_PERF, 'BIG_PERF=1');

const out = (k: string, v: number) => process.stdout.write(`${k}=${Math.round(v)}\n`);

/** sum and max of long tasks (main thread > 50 ms) since the last call */
const longTasks = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __lt: number[] };
    const a = w.__lt.splice(0);
    return { sum: a.reduce((s, x) => s + x, 0), max: Math.max(0, ...a) };
  });

/** ms until the selector appears, from the call; then 1 s for the tail of long tasks */
async function timed(page: Page, name: string, act: () => Promise<unknown>, sel: string) {
  await longTasks(page);
  const t0 = Date.now();
  await act();
  await page.locator(sel).first().waitFor({ timeout: 120_000 });
  out(`${name}_ms`, Date.now() - t0);
  await page.waitForTimeout(1000);
  const lt = await longTasks(page);
  out(`${name}_longtask_sum_ms`, lt.sum);
  out(`${name}_longtask_max_ms`, lt.max);
}

/** the replica has a cursor (written once the whole bootstrap is in); does not create the database */
const hasCursor = (page: Page) =>
  page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((d) => d.name === 'planar')) return false;
    return new Promise<boolean>((res) => {
      const r = indexedDB.open('planar');
      r.onerror = () => res(false);
      r.onsuccess = () => {
        const db = r.result;
        try {
          const g = db.transaction('_meta').objectStore('_meta').get('cursor');
          g.onsuccess = () => res(g.result !== undefined);
          g.onerror = () => res(false);
        } catch {
          res(false);
        }
        db.close();
      };
    });
  });

/** browser context logged in as the client, with a long-task recorder (empty IndexedDB — a first entry) */
async function context(browser: Browser, as: Client) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    locale: 'ru-RU',
    storageState: await as.ctx.storageState(),
  });
  await ctx.addInitScript(() => {
    const w = window as unknown as { __lt: number[] };
    w.__lt = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__lt.push(e.duration);
    }).observe({ type: 'longtask', buffered: true });
    // rows read from IndexedDB per store: what an action costs regardless of where the read comes from
    const rd = ((window as unknown as { __rows: Record<string, number> }).__rows = {});
    const add = (s: string, n: number) => (rd[s] = (rd[s] ?? 0) + n);
    const store = (t: IDBObjectStore | IDBIndex) =>
      'objectStore' in t ? t.objectStore.name : t.name;
    for (const P of [IDBObjectStore.prototype, IDBIndex.prototype] as (
      IDBObjectStore | IDBIndex
    )[]) {
      const getAll = P.getAll;
      P.getAll = function (this: IDBObjectStore | IDBIndex, ...a: unknown[]) {
        const r = (getAll as (...x: unknown[]) => IDBRequest<unknown[]>).apply(this, a);
        r.addEventListener('success', () => add(store(this), r.result.length));
        return r;
      };
      const open = P.openCursor;
      P.openCursor = function (this: IDBObjectStore | IDBIndex, ...a: unknown[]) {
        const r = (open as (...x: unknown[]) => IDBRequest<IDBCursor | null>).apply(this, a);
        r.addEventListener('success', () => r.result && add(store(this), 1));
        return r;
      };
    }
  });
  return ctx;
}

/** IndexedDB rows read since the last call, largest stores first */
const rowsRead = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __rows: Record<string, number> };
    const r = Object.entries(w.__rows).sort((a, b) => b[1] - a[1]);
    for (const k of Object.keys(w.__rows)) delete w.__rows[k];
    return r;
  });

/** in-page marks of action(): pointerdown and the frame where done saw the result (done sets __t1) */
type Marks = { __t0: number; __t1: number };

/**
 * ms from the start of act until done resolves, then the long tasks of the following second;
 * BIG_PROF_DIR=<dir> — CPU profile of the action into <dir>/<name>.cpuprofile (profile/analyze.mjs)
 */
async function action(
  page: Page,
  name: string,
  act: () => Promise<unknown>,
  done: () => Promise<unknown>,
) {
  await page.waitForTimeout(1000);
  await longTasks(page);
  await rowsRead(page);
  const dir = process.env.BIG_PROF_DIR;
  const cdp = dir ? await page.context().newCDPSession(page) : undefined;
  if (cdp) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }
  await page.evaluate(() => {
    const w = window as unknown as Marks;
    w.__t0 = w.__t1 = 0;
    addEventListener('pointerdown', () => (w.__t0 = performance.now()), {
      capture: true,
      once: true,
    });
  });
  const t0 = Date.now();
  await act();
  await done();
  out(`${name}_ms`, Date.now() - t0);
  // without Playwright's actionability checks before the click: pointerdown → the frame with the result
  out(
    `${name}_input_ms`,
    await page.evaluate(
      () => (window as unknown as Marks).__t1 - (window as unknown as Marks).__t0,
    ),
  );
  await page.waitForTimeout(1000);
  const lt = await longTasks(page);
  out(`${name}_longtask_sum_ms`, lt.sum);
  out(`${name}_longtask_max_ms`, lt.max);
  const rows = await rowsRead(page);
  out(
    `${name}_idb_rows`,
    rows.reduce((s, [, n]) => s + n, 0),
  );
  for (const [s, n] of rows.slice(0, 5)) out(`${name}_idb_rows_${s}`, n);
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    mkdirSync(dir!, { recursive: true });
    writeFileSync(`${dir}/${name}.cpuprofile`, JSON.stringify(profile));
  }
}

test('большие данные: загрузка, экраны, колокольчик', async ({ browser }) => {
  test.setTimeout(900_000);
  const admin = await Client.login('admin');
  const { data } = await admin.bootstrap();
  const projects = data.projects as { id: string; key: string }[];
  const tasks = data.tasks as { projectId: string }[];
  const count = (id: string) => tasks.filter((t) => t.projectId === id).length;
  const big = [...projects].sort((a, b) => count(b.id) - count(a.id))[0]!;
  out('tasks_total', tasks.length);
  out('project_tasks', count(big.id));
  out('notifications', (data.notifications as unknown[]).length);
  const r = await admin.ctx.get(`/sync/bootstrap?clientId=${admin.clientId}`);
  out('bootstrap_bytes', (await r.body()).length);

  const ctx = await context(browser, admin);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByTestId('sidebar').waitFor({ timeout: 120_000 });
  await timed(page, 'cold_home', async () => {}, '[data-testid=sidebar]');
  await page.waitForTimeout(5000); // deferred bootstrap batches
  out('cold_tail_longtask_sum_ms', (await longTasks(page)).sum);

  await timed(page, 'list', () => page.goto(`/p/${big.id}/list`), '[role=row][data-task]');
  await timed(page, 'board', () => page.goto(`/p/${big.id}/board`), '[data-task]');
  await timed(page, 'work', () => page.goto('/w/work'), 'main');
  await timed(page, 'home', () => page.goto('/w'), 'main');

  // the bootstrap brings 200 notifications; whoever was online during the import has thousands: alice comments admin's tasks
  const n = Number(process.env.BIG_NOTIFY ?? 1500);
  const alice = await Client.login('alice');
  const own = (data.tasks as { id: string; projectId: string }[]).filter(
    (t) => t.projectId === big.id,
  );
  const t0 = Date.now();
  await alice.pushOk(
    Array.from({ length: n }, (_, i) =>
      alice.mut('comment.create', {
        id: crypto.randomUUID(),
        taskId: own[i % own.length]!.id,
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: `perf ${i}` }] }],
        },
      }),
    ),
  );
  out('notify_push_ms', Date.now() - t0);
  await page.waitForFunction(
    (k) => Number(document.querySelector('[data-testid=bell-count]')?.textContent ?? 0) >= k,
    n,
    { timeout: 300_000 },
  );
  out('notify_arrive_ms', Date.now() - t0);
  await page.waitForTimeout(2000);
  out('notify_longtask_sum_ms', (await longTasks(page)).sum);

  await timed(page, 'inbox', () => page.goto('/w/work?w=activity'), '[data-testid=inbox-item]');
  await timed(page, 'bell_open', () => page.getByTestId('bell').click(), '[data-testid=bell-menu]');
  const unread = Number((await page.getByTestId('bell-count').textContent()) ?? 0);
  out('bell_unread', unread);
  if (unread) {
    await longTasks(page);
    const t0 = Date.now();
    await page.getByTestId('bell-read-all').click();
    await page.getByTestId('bell-count').waitFor({ state: 'detached', timeout: 300_000 });
    out('read_all_ms', Date.now() - t0);
    await page.waitForTimeout(1000);
    const lt = await longTasks(page);
    out('read_all_longtask_sum_ms', lt.sum);
    out('read_all_longtask_max_ms', lt.max);
  }
  await ctx.close();
});

// PLNRAPP-248: actions against the budgets (first entry < 1.5 s, local action < 50 ms, server mutation p50 < 15 ms)
test('большие данные: первый вход, комментарий, статус, мутация', async ({ browser }) => {
  test.setTimeout(2_700_000);
  const admin = await Client.login('admin');
  const { data } = await admin.bootstrap();
  const projects = data.projects as { id: string; key: string }[];
  const tasks = data.tasks as {
    id: string;
    projectId: string;
    number: number;
    description: unknown;
  }[];
  const count = (id: string) => tasks.filter((t) => t.projectId === id).length;
  const big = [...projects].sort((a, b) => count(b.id) - count(a.id))[0]!;
  const raw = await (await admin.ctx.get(`/sync/bootstrap?clientId=${admin.clientId}`)).body();
  out('bootstrap_bytes', raw.length);
  const sizes = Object.entries(data)
    .map(([k, v]) => [k, JSON.stringify(v).length] as const)
    .sort((a, b) => b[1] - a[1]);
  for (const [k, b] of sizes.slice(0, 8)) out(`bytes_${k}`, b);
  out(
    'bytes_tasks_description',
    tasks.reduce((s, t) => s + JSON.stringify(t.description ?? null).length, 0),
  );
  const comments = data.comments as { taskId: string; body: unknown }[];
  out(
    'bytes_comments_body',
    comments.reduce((s, c) => s + JSON.stringify(c.body).length, 0),
  );

  // the task with the longest feed
  const per = new Map<string, number>();
  for (const c of comments) per.set(c.taskId, (per.get(c.taskId) ?? 0) + 1);
  const [hotId, hotN] = [...per].sort((a, b) => b[1] - a[1])[0] ?? [tasks[0]!.id, 0];
  const hot = tasks.find((t) => t.id === hotId)!;
  const key = `${projects.find((p) => p.id === hot.projectId)!.key}-${hot.number}`;
  out('hot_comments', hotN);

  // first entry: empty IndexedDB → the list of the largest project and an opened card
  const ctx = await context(browser, admin);
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(`/p/${hot.projectId}/list`);
  await page.locator('[role=row][data-task]').first().waitFor({ timeout: 300_000 });
  out('first_list_ms', Date.now() - t0);
  await page.locator('[role=row][data-task]').first().click();
  await page.getByRole('textbox', { name: /Написать комментарий/ }).waitFor({ timeout: 300_000 });
  out('first_card_ms', Date.now() - t0);
  // the cursor is written once the deferred part of the bootstrap is in the replica
  while (!(await hasCursor(page))) {
    if (Date.now() - t0 > 1_800_000) throw new Error('реплика не заполнилась за 30 мин');
    await page.waitForTimeout(2000);
  }
  out('first_complete_ms', Date.now() - t0);
  out('first_tail_longtask_sum_ms', (await longTasks(page)).sum);

  // a comment in the longest feed, with the list underneath
  await page.goto(`/p/${hot.projectId}/list?task=${key}`);
  await page
    .getByTestId('comment')
    .nth(Math.max(0, Math.min(hotN, 50) - 1))
    .waitFor({ timeout: 120_000 });
  const editor = page.getByRole('textbox', { name: /Написать комментарий/ });
  await editor.click();
  const text = `perf ${Date.now()}`;
  await editor.pressSequentially(text);
  // by the count of comments: a hasText filter walks the text of the whole feed on every poll and inflates long tasks
  const n = await page.getByTestId('comment').count();
  await action(
    page,
    'comment',
    () => page.getByTestId('comment-send').click(),
    () =>
      page.waitForFunction(
        (k) =>
          document.querySelectorAll('[data-testid=comment]').length > k &&
          ((window as unknown as Marks).__t1 = performance.now()),
        n,
      ),
  );
  await page.getByTestId('comment').filter({ hasText: text }).waitFor();

  // status change in the same card
  const pill = page.getByTestId('status-pill');
  const before = (await pill.textContent())?.trim() ?? '';
  await pill.getByRole('button').first().click();
  const option = page.getByRole('option').filter({ hasNotText: before }).first();
  const next = (await option.textContent())?.trim() ?? '';
  await action(
    page,
    'status',
    () => option.click(),
    // every frame, like the comment: expect() polls at 100/250/500 ms and inflates the time
    () =>
      page.waitForFunction(
        (t) =>
          document.querySelector('[data-testid=status-pill]')?.textContent?.includes(t) &&
          ((window as unknown as Marks).__t1 = performance.now()),
        next,
        { timeout: 120_000 },
      ),
  );
  await ctx.close();

  // server: sequential single-mutation pushes
  const own = tasks.filter((t) => t.projectId === big.id).slice(0, 50);
  const ms: number[] = [];
  for (const [i, t] of own.entries()) {
    const s = Date.now();
    await admin.pushOk([admin.mut('task.update', { id: t.id, title: `perf ${i}` })]);
    ms.push(Date.now() - s);
  }
  ms.sort((a, b) => a - b);
  out('push_p50_ms', ms[Math.floor(ms.length / 2)]!);
  out('push_p95_ms', ms[Math.floor(ms.length * 0.95)]!);
});
