import { expect, test, type Page } from '@playwright/test';
import { fixture, uniq } from './helpers.js';

// PJ-9: on mobile a task opens over the view; back keeps the view state (scroll, URL)
async function mobileLogin(browser: import('@playwright/test').Browser): Promise<Page> {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    locale: 'ru-RU',
    viewport: { width: 390, height: 800 },
  });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Логин').fill('alice');
  await page.getByLabel('Пароль').fill('alice');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: /меню|навигац/i }).first()).toBeVisible();
  return page;
}

for (const view of ['list', 'table', 'board']) {
  test(`PJ-9: ${view} — задача поверх вида, назад возвращает ту же прокрутку`, async ({
    browser,
  }) => {
    const f = await fixture(Array.from({ length: 40 }, (_, i) => uniq(`Задача ${i}`)));
    const page = await mobileLogin(browser);
    await page.goto(`/p/${f.projectId}/${view}`);
    const last = page.locator(`[data-task="${f.taskKeys.at(-1)}"]`).first();
    // list and table are virtualised: the last row is not in the DOM until scrolled to
    await page.getByRole('main').hover();
    await expect
      .poll(async () => {
        if (await last.count()) return true;
        await page.mouse.wheel(0, 800);
        return false;
      })
      .toBe(true);
    await last.scrollIntoViewIfNeeded();
    const before = (await last.boundingBox())!.y;
    const url = page.url();
    // in the table a task opens by its key button (a click elsewhere in the row edits a cell)
    if (view === 'table') await last.getByRole('button', { name: f.taskKeys.at(-1)! }).click();
    else await last.click();
    await expect(page.getByTestId('task-modal')).toBeVisible();
    expect(page.url()).toContain(`task=${f.taskKeys.at(-1)}`);
    await page.goBack();
    await expect(page.getByTestId('task-modal')).toHaveCount(0);
    expect(page.url()).toBe(url);
    expect(Math.abs((await last.boundingBox())!.y - before)).toBeLessThan(2);
    // a direct link still opens the task page
    await page.goto(`/t/${f.taskKeys[0]}`);
    await expect(page.getByTestId('task-modal')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/t/${f.taskKeys[0]}`));
  });
}
