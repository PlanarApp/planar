import { expect, test } from '@playwright/test';
import { Client, ranks, uuidv7 } from '../lib.js';
import { fixture, uniq } from './helpers.js';

// PJ-15: on mobile a task from «Моя работа» opens over the view; back keeps scroll and the selected view
// (the group tab «Моя работа» and the standalone screen /my)
for (const [name, path, rowSel, oneSel] of [
  [
    'вкладка группы',
    '/w/work?w=assigned',
    // the list is grouped and virtualised: own rows are not necessarily in the DOM, any rendered row will do
    () => '[role=row][data-task]',
    (key: string) => `[data-task="${key}"]`,
  ],
  [
    'экран /my',
    '/my',
    (k: string) => `[data-testid=my-row]:has-text("${k}-")`,
    (key: string) => `[data-testid=my-row] >> text="${key}"`,
  ],
] as const) {
  test(`PJ-15: ${name} — задача поверх вида, назад возвращает прокрутку и вид`, async ({
    browser,
  }) => {
    const alice = await Client.login('alice');
    const f = await fixture([]);
    await f.admin.pushOk(
      ranks(40).map((rank, i) =>
        f.admin.mut('task.create', {
          id: uuidv7(),
          projectId: f.projectId,
          statusId: f.statusIds[0],
          title: uniq(`Моя ${i}`),
          rank,
          assignees: [{ id: uuidv7(), userId: alice.userId }],
        }),
      ),
    );
    const ctx = await browser.newContext({
      baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
      locale: 'ru-RU',
      viewport: { width: 390, height: 800 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.getByLabel('Логин').fill('alice');
    await page.getByLabel('Пароль').fill('alice');
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));

    await page.goto(path);
    const row = page.locator(rowSel(f.key));
    await expect(row.first()).toBeVisible();
    // pin the row by its key: the list may be virtualized, row.last() changes with the scroll
    const lastKey = (await row
      .last()
      .evaluate((e) => e.getAttribute('data-task') ?? e.textContent))!.match(/[A-Z]+-\d+/)![0];
    const last = page.locator(oneSel(lastKey)).first();
    await last.scrollIntoViewIfNeeded();
    const before = (await last.boundingBox())!.y;
    // selected view tab (the group tab only; /my has none)
    const tabs = page.getByTestId('view-tabs').getByRole('tab');
    const selected = () => tabs.evaluateAll((t) => t.findIndex((e) => e.ariaSelected === 'true'));
    const sel = await selected();
    const url = page.url();
    await last.click();
    await expect(page.getByTestId('task-modal')).toBeVisible();
    await expect(page).toHaveURL(/task=/);
    await page.goBack();
    await expect(page.getByTestId('task-modal')).toHaveCount(0);
    expect(page.url()).toBe(url);
    expect(Math.abs((await last.boundingBox())!.y - before)).toBeLessThan(2);
    expect(await selected()).toBe(sel);
  });
}
