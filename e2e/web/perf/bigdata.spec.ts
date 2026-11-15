import { test, type Page } from '@playwright/test';
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

  const ctx = await browser.newContext({
    baseURL: BASE,
    locale: 'ru-RU',
    storageState: await admin.ctx.storageState(),
  });
  await ctx.addInitScript(() => {
    const w = window as unknown as { __lt: number[] };
    w.__lt = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__lt.push(e.duration);
    }).observe({ type: 'longtask', buffered: true });
  });
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
