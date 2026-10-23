import { test, type BrowserContext, type Page } from '@playwright/test';
import { BASE, Client } from '../../lib';

const ROW = '[role=row][data-task]';

const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
const median = (a: number[]) => sorted(a)[Math.floor((a.length - 1) / 2)]!;
const p95 = (a: number[]) => sorted(a)[Math.min(a.length - 1, Math.ceil(a.length * 0.95) - 1)]!;
const out = (k: string, v: number) => process.stdout.write(`${k}=${v.toFixed(1)}\n`);

/** Контекст с сессией пользователя (вход через API, cookie в браузер). */
async function ctxFor(
  browser: import('@playwright/test').Browser,
  c: Client,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: BASE,
    storageState: await c.ctx.storageState(),
  });
  // момент появления первой строки списка: performance.now() от navigationStart
  await context.addInitScript((sel) => {
    const w = window as unknown as { __first?: number };
    new MutationObserver((_, o) => {
      if (document.querySelector(sel)) {
        w.__first = performance.now();
        o.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  }, ROW);
  return context;
}

async function firstRow(page: Page): Promise<number> {
  await page.waitForFunction(
    () => (window as unknown as { __first?: number }).__first !== undefined,
  );
  return page.evaluate(() => (window as unknown as { __first: number }).__first);
}

/** Правит название задачи через UI; в странице: Enter (keydown) → смена текста строки. */
async function editTitle(page: Page, key: string, title: string): Promise<number> {
  const row = page.locator(`[data-task="${key}"]`);
  await row.locator('span.truncate.block').dblclick();
  const input = row.getByRole('textbox');
  await input.fill(title);
  const done = page.evaluate(
    ([k, t]) =>
      new Promise<number>((res) => {
        let t0 = 0;
        document.addEventListener('keydown', (e) => e.key === 'Enter' && (t0 = performance.now()), {
          capture: true,
          once: true,
        });
        const mo = new MutationObserver(() => {
          const el = document.querySelector(`[data-task="${k}"] span.truncate.block`);
          if (t0 && el?.textContent === t) {
            mo.disconnect();
            res(performance.now() - t0);
          }
        });
        mo.observe(document, { childList: true, subtree: true, characterData: true });
      }),
    [key, title] as const,
  );
  await page.keyboard.press('Enter');
  return done;
}

test('бюджеты §7', async ({ browser }) => {
  const admin = await Client.login('admin');
  const alice = await Client.login('alice');
  const { data } = await admin.bootstrap();
  const projects = data.projects as { id: string; key: string }[];
  const tasks = data.tasks as { projectId: string }[];
  const count = (id: string) => tasks.filter((t) => t.projectId === id).length;
  const [big, other] = [...projects].sort((a, b) => count(b.id) - count(a.id));
  if (!big || !other) throw new Error('нужны два проекта');
  process.stdout.write(
    `tasks_total=${tasks.length}\nproject_tasks=${count(big.id)}\nproject=${big.key}\n`,
  );
  const url = `/p/${big.id}`;

  // cold: новый контекст (пустой IndexedDB), от goto до первой строки; медиана 3
  const cold: number[] = [];
  for (let i = 0; i < 3; i++) {
    const c = await ctxFor(browser, admin);
    const p = await c.newPage();
    await p.goto(url);
    cold.push(await firstRow(p));
    await c.close();
  }
  out('cold_bootstrap_ms', median(cold));

  // warm: тот же контекст (IndexedDB заполнена), reload, медиана 5
  const ctx = await ctxFor(browser, admin);
  const page = await ctx.newPage();
  await page.goto(url);
  await firstRow(page);
  await page.waitForTimeout(2000); // дать доехать bootstrap до IndexedDB
  const warm: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.reload();
    warm.push(await firstRow(page));
  }
  out('warm_start_ms', median(warm));

  // mutate: 20 правок названия через UI
  const keys = await page
    .locator(ROW)
    .evaluateAll((e) => e.slice(0, 20).map((r) => r.getAttribute('data-task')!));
  const mut: number[] = [];
  for (const [i, k] of keys.entries())
    mut.push(await editTitle(page, k, `perf ${i} ${Date.now()}`));
  out('mutate_ms_p95', p95(mut));
  out('mutate_ms_median', median(mut));

  // switch: 10 кликов в боковой панели между двумя проектами
  const sw: number[] = [];
  for (let i = 0; i < 10; i++) {
    const to = i % 2 === 0 ? other : big;
    sw.push(
      await page.evaluate(
        ([id, key]) =>
          new Promise<number>((res) => {
            const link = document.querySelector<HTMLElement>(
              `[data-testid=sidebar] a[href="/p/${id}"]`,
            )!;
            const t0 = performance.now();
            const check = () => {
              const rows = [...document.querySelectorAll(`[role=row][data-task^="${key}-"]`)];
              if (rows.length) return (res(performance.now() - t0), mo.disconnect(), true);
              return false;
            };
            const mo = new MutationObserver(check);
            mo.observe(document, { childList: true, subtree: true });
            link.click();
          }),
        [to.id, to.key] as const,
      ),
    );
    await page.waitForTimeout(300);
  }
  out('project_switch_ms_p95', p95(sw));

  // scroll: 5 с колесом по ~100 px каждые 16 мс, кадры через rAF
  await page.goto(url);
  await firstRow(page);
  const box = (await page.locator('[role=grid]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean };
    w.__frames = [];
    w.__stop = false;
    let last = 0;
    const f = (t: number) => {
      if (last) w.__frames.push(t - last);
      last = t;
      if (!w.__stop) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(16);
  }
  const frames = await page.evaluate(() => {
    (window as unknown as { __stop: boolean }).__stop = true;
    return (window as unknown as { __frames: number[] }).__frames;
  });
  out('scroll_frame_ms_p95', p95(frames));
  out('scroll_long_frames', frames.filter((f) => f > 50).length);
  process.stdout.write(`scroll_frames_n=${frames.length}\n`);
  await ctx.close();

  // realtime: admin (A) правит, alice (B) видит; часы одной машины (Date.now)
  const ca = await ctxFor(browser, admin);
  const cb = await ctxFor(browser, alice);
  const [a, b] = [await ca.newPage(), await cb.newPage()];
  await Promise.all([a.goto(url), b.goto(url)]);
  await Promise.all([firstRow(a), firstRow(b)]);
  await b.waitForTimeout(2000);
  const rk = await a
    .locator(ROW)
    .evaluateAll((e) => e.slice(0, 10).map((r) => r.getAttribute('data-task')!));
  const rt: number[] = [];
  for (const [i, k] of rk.entries()) {
    const title = `rt ${i} ${Date.now()}`;
    const seen = b.evaluate(
      ([k, t]) =>
        new Promise<number>((res) => {
          const ok = () =>
            document.querySelector(`[data-task="${k}"] span.truncate.block`)?.textContent === t;
          const mo = new MutationObserver(() => ok() && (mo.disconnect(), res(Date.now())));
          mo.observe(document, { childList: true, subtree: true, characterData: true });
        }),
      [k, title] as const,
    );
    const sent = a.evaluate(
      () =>
        new Promise<number>((res) =>
          document.addEventListener('keydown', (e) => e.key === 'Enter' && res(Date.now()), {
            capture: true,
            once: true,
          }),
        ),
    );
    const row = a.locator(`[data-task="${k}"]`);
    await row.locator('span.truncate.block').dblclick();
    await row.getByRole('textbox').fill(title);
    await a.keyboard.press('Enter');
    rt.push((await seen) - (await sent));
  }
  out('realtime_ms_p95', p95(rt));
  out('realtime_ms_median', median(rt));
  await Promise.all([ca.close(), cb.close()]);
});
