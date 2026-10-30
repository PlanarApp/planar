import { test } from '@playwright/test';
import { BASE, Client } from '../../lib';

// Measurement of the 'Timeline' (PT-2): large project with 10,000 seed tasks (PERF_SEED_DATES=1, PERF_MODULES=timeline),
// 2 s of wheel scrolling vertically and horizontally; long tasks > 50 ms are counted.
test('таймлайн: прокрутка без long task', async ({ browser }) => {
  const admin = await Client.login('admin');
  const { data } = await admin.bootstrap();
  const projects = data.projects as { id: string; key: string }[];
  const tasks = data.tasks as { projectId: string }[];
  const count = (id: string) => tasks.filter((t) => t.projectId === id).length;
  const big = [...projects].sort((a, b) => count(b.id) - count(a.id))[0]!;
  process.stdout.write(`project=${big.key}\nproject_tasks=${count(big.id)}\n`);

  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1280, height: 800 },
    storageState: await admin.ctx.storageState(),
  });
  await ctx.addInitScript(() => {
    const w = window as unknown as { __lt: { start: number; dur: number }[] };
    w.__lt = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__lt.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  });
  const page = await ctx.newPage();
  await page.goto(`/p/${big.id}/timeline:timeline`);
  await page.getByTestId('tl-bar').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500); // let the initial render settle

  const scroll = page.getByTestId('tl-scroll');
  const box = (await scroll.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const t0 = await page.evaluate(() => performance.now());
  const t = Date.now();
  for (let i = 0; Date.now() - t < 2000; i++) {
    await page.mouse.wheel(i % 2 ? 300 : 0, i % 2 ? 0 : 400);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  const over = await page.evaluate(
    (from) =>
      (window as unknown as { __lt: { start: number; dur: number }[] }).__lt.filter(
        (e) => e.start >= from && e.dur > 50,
      ).length,
    t0,
  );
  const rows = await page.locator('[data-tl-task]').count();
  process.stdout.write(`timeline_rows=${rows}\ntimeline_longtasks_over50=${over}\n`);
});
