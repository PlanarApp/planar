import { writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { BASE, Client } from '../../lib';

// PLNRAPP-247: CPU profile of a warm open of the large project's list — BIG_PROF=<out.cpuprofile>
test.skip(!process.env.BIG_PROF, 'BIG_PROF=<file>');

test('профиль: тёплое открытие списка', async ({ browser }) => {
  test.setTimeout(300_000);
  const admin = await Client.login('admin');
  const { data } = await admin.bootstrap();
  const tasks = data.tasks as { projectId: string }[];
  const n = new Map<string, number>();
  for (const t of tasks) n.set(t.projectId, (n.get(t.projectId) ?? 0) + 1);
  const big = [...n].sort((a, b) => b[1] - a[1])[0]![0];
  const ctx = await browser.newContext({
    baseURL: BASE,
    storageState: await admin.ctx.storageState(),
  });
  const page = await ctx.newPage();
  const url = process.env.BIG_URL?.replace('{p}', big) ?? `/p/${big}/list`;
  await page.goto(url);
  await page
    .locator(process.env.BIG_SEL ?? '[role=row][data-task]')
    .first()
    .waitFor({ timeout: 120_000 });
  await page.waitForTimeout(8000);
  const s = await ctx.newCDPSession(page);
  await s.send('Profiler.enable');
  await s.send('Profiler.setSamplingInterval', { interval: 500 });
  await s.send('Profiler.start');
  const t0 = Date.now();
  await page.reload();
  await page
    .locator(process.env.BIG_SEL ?? '[role=row][data-task]')
    .first()
    .waitFor({ timeout: 120_000 });
  process.stdout.write(`first_ms=${Date.now() - t0}\n`);
  await page.waitForTimeout(1500);
  const { profile } = await s.send('Profiler.stop');
  writeFileSync(process.env.BIG_PROF!, JSON.stringify(profile));
  await ctx.close();
});
