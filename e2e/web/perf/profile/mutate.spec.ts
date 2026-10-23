import { test } from '@playwright/test';
import { Client } from '../../../lib';
import { ROW, Prof, ctxFor, editTitle, events, firstRow, median, p95, projects, save } from './lib';

const PROF = !!process.env.PROF;
test('mutate', async ({ browser }) => {
  const admin = await Client.login('admin');
  const { big } = await projects(admin);
  const ctx = await ctxFor(browser, admin);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 300)));
  await page.goto(`/p/${big.id}`);
  await firstRow(page);
  await page.waitForTimeout(3000);
  const keys = await page.locator(ROW).evaluateAll((e) => e.slice(0, 5).map((r) => r.getAttribute('data-task')!));
  const prof = new Prof(page);
  if (PROF) await prof.start();
  const runs: any[] = [];
  const ms: number[] = [];
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => ((window as any).__ev.length = 0));
    const [t0, t1] = await editTitle(page, keys[i % 5]!, `perf ${i} ${Date.now()}`);
    await page.waitForTimeout(1500);
    ms.push(t1 - t0);
    console.log('it', i, (t1 - t0).toFixed(0));
    const ev = (await events(page)).filter((e) => (e.t0 ?? e.t ?? 0) >= t0 - 1);
    runs.push({ ms: t1 - t0, t0, ev: ev.map((e) => ({ ...e, t0: e.t0 !== undefined ? +(e.t0 - t0).toFixed(1) : undefined, t1: e.t1 !== undefined ? +(e.t1 - t0).toFixed(1) : undefined, t: e.t !== undefined ? +(e.t - t0).toFixed(1) : undefined })) });
  }
  if (PROF) await prof.stop('mutate');
  console.log(`mutate p95=${p95(ms).toFixed(1)} med=${median(ms).toFixed(1)} all=${ms.map((x) => x.toFixed(0))}`);
  save(PROF ? 'mutate-prof' : 'mutate', { p95: p95(ms), median: median(ms), ms, runs });
  await ctx.close();
});
