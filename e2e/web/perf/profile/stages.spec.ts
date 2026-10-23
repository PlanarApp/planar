import { test, type Page } from '@playwright/test';
import { Client } from '../../../lib';
import { ROW, Prof, ctxFor, events, firstRow, median, p95, projects, save } from './lib';

const PROF = !!process.env.PROF;
const rel = (ev: any[], t0 = 0) =>
  ev.map((e) => {
    const o: any = { ...e };
    for (const k of ['t0', 't1', 't', 'tH', 'tJ0']) if (typeof o[k] === 'number') o[k] = +(o[k] - t0).toFixed(1);
    return o;
  });
const navInfo = (page: Page) =>
  page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const res = performance.getEntriesByType('resource').map((r: any) => [r.name.replace(location.origin, ''), +r.startTime.toFixed(0), +r.responseEnd.toFixed(0), r.transferSize, r.decodedBodySize]);
    return { nav: { resp: n.responseEnd, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd }, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime, res };
  });

async function loadScenario(name: 'cold' | 'warm', browser: any) {
  const admin = await Client.login('admin');
  const { big, counts } = await projects(admin);
  const url = `/p/${big.id}`;
  const runs: any[] = [];
  const ms: number[] = [];
  if (name === 'cold') {
    for (let i = 0; i < 3; i++) {
      const c = await ctxFor(browser, admin);
      const p = await c.newPage();
      const prof = new Prof(p);
      if (PROF && i === 2) await prof.start();
      await p.goto(url);
      const t = await firstRow(p);
      await p.waitForTimeout(1500);
      if (PROF && i === 2) await prof.stop('cold');
      ms.push(t);
      runs.push({ ms: t, ev: rel(await events(p)), ...(await navInfo(p)) });
      await c.close();
    }
  } else {
    const ctx = await ctxFor(browser, admin);
    const p = await ctx.newPage();
    await p.goto(url);
    await firstRow(p);
    await p.waitForTimeout(3000);
    const prof = new Prof(p);
    for (let i = 0; i < 5; i++) {
      if (PROF && i === 4) await prof.start();
      await p.reload();
      const t = await firstRow(p);
      await p.waitForTimeout(1500);
      if (PROF && i === 4) await prof.stop('warm');
      ms.push(t);
      runs.push({ ms: t, ev: rel(await events(p)), ...(await navInfo(p)) });
    }
    await ctx.close();
  }
  console.log(`${name} median=${median(ms).toFixed(0)} all=${ms.map((x) => x.toFixed(0))}`);
  save(PROF ? `${name}-prof` : name, { counts, median: median(ms), ms, runs });
}
test('cold', ({ browser }) => loadScenario('cold', browser));
test('warm', ({ browser }) => loadScenario('warm', browser));

test('switch', async ({ browser }) => {
  const admin = await Client.login('admin');
  const { big, other, counts } = await projects(admin);
  const ctx = await ctxFor(browser, admin);
  const page = await ctx.newPage();
  await page.goto(`/p/${big.id}`);
  await firstRow(page);
  await page.waitForTimeout(3000);
  const prof = new Prof(page);
  if (PROF) await prof.start();
  const runs: any[] = [];
  for (let i = 0; i < 10; i++) {
    const to = i % 2 === 0 ? other : big;
    await page.evaluate(() => ((window as any).__ev.length = 0));
    const t0 = await page.evaluate(
      ([id, key]) =>
        new Promise<number>((res) => {
          const link = document.querySelector<HTMLElement>(`[data-testid=sidebar] a[href="/p/${id}"]`)!;
          const t0 = performance.now();
          const mo = new MutationObserver(() => {
            if (document.querySelector(`[role=row][data-task^="${key}-"]`)) {
              const t1 = performance.now();
              ((window as any).__ev as any[]).push({ k: 'dom', t: t1 });
              mo.disconnect();
              res(t1 - t0);
            }
          });
          mo.observe(document, { childList: true, subtree: true });
          ((window as any).__ev as any[]).push({ k: 'click', t: t0 });
          link.click();
        }),
      [to.id, to.key] as const,
    );
    await page.waitForTimeout(1500);
    const ev = await events(page);
    const c0 = ev.find((e) => e.k === 'click').t;
    runs.push({ to: to === big ? 'big' : 'other', ms: t0, ev: rel(ev, c0) });
  }
  if (PROF) await prof.stop('switch');
  const ms = runs.map((r) => r.ms);
  const bigs = runs.filter((r) => r.to === 'big').map((r) => r.ms);
  console.log(`switch p95=${p95(ms).toFixed(0)} big=${bigs.map((x) => x.toFixed(0))} other=${runs.filter((r) => r.to === 'other').map((r) => r.ms.toFixed(0))}`);
  save(PROF ? 'switch-prof' : 'switch', { counts, p95: p95(ms), ms, runs });
  await ctx.close();
});

test('realtime', async ({ browser }) => {
  const admin = await Client.login('admin');
  const alice = await Client.login('alice');
  const { big, counts } = await projects(admin);
  const url = `/p/${big.id}`;
  const ca = await ctxFor(browser, admin);
  const cb = await ctxFor(browser, alice);
  const [a, b] = [await ca.newPage(), await cb.newPage()];
  await Promise.all([a.goto(url), b.goto(url)]);
  await Promise.all([firstRow(a), firstRow(b)]);
  await b.waitForTimeout(3000);
  const rk = await a.locator(ROW).evaluateAll((e) => e.slice(0, 10).map((r) => r.getAttribute('data-task')!));
  const prof = new Prof(b);
  if (PROF) await prof.start();
  const runs: any[] = [];
  for (const [i, k] of rk.entries()) {
    const title = `rt ${i} ${Date.now()}`;
    await Promise.all([a, b].map((p) => p.evaluate(() => ((window as any).__ev.length = 0))));
    const seen = b.evaluate(
      ([k, t]) =>
        new Promise<number>((res) => {
          const ok = () => document.querySelector(`[data-task="${k}"] span.truncate.block`)?.textContent === t;
          const mo = new MutationObserver(() => {
            if (ok()) {
              mo.disconnect();
              ((window as any).__ev as any[]).push({ k: 'dom', t: performance.now() });
              res(Date.now());
            }
          });
          mo.observe(document, { childList: true, subtree: true, characterData: true });
        }),
      [k, title] as const,
    );
    const sent = a.evaluate(
      () => new Promise<number>((res) => document.addEventListener('keydown', (e) => e.key === 'Enter' && (((window as any).__ev as any[]).push({ k: 'enter', t: performance.now() }), res(Date.now())), { capture: true, once: true })),
    );
    const row = a.locator(`[data-task="${k}"]`);
    await row.locator('span.truncate.block').dblclick();
    await row.getByRole('textbox').fill(title);
    await a.keyboard.press('Enter');
    const ms = (await seen) - (await sent);
    await a.waitForTimeout(1500);
    const [ea, eb] = await Promise.all([events(a), events(b)]);
    // общая шкала: мс от Enter на A (Date.now-часы: timeOrigin + now)
    const [oa, ob] = await Promise.all([a, b].map((p) => p.evaluate(() => performance.timeOrigin)));
    const enter = ea.find((e) => e.k === 'enter').t + oa!;
    runs.push({ ms, A: rel(ea.map((e) => shift(e, oa! - enter))), B: rel(eb.map((e) => shift(e, ob! - enter))) });
  }
  const ms = runs.map((r) => r.ms);
  if (PROF) await prof.stop('realtime');
  console.log(`realtime p95=${p95(ms).toFixed(0)} med=${median(ms).toFixed(0)} all=${ms}`);
  save(PROF ? 'realtime-prof' : 'realtime', { counts, p95: p95(ms), median: median(ms), ms, runs });
  await Promise.all([ca.close(), cb.close()]);
});
function shift(e: any, d: number) {
  const o: any = { ...e };
  for (const k of ['t0', 't1', 't', 'tH', 'tJ0']) if (typeof o[k] === 'number') o[k] += d;
  return o;
}
