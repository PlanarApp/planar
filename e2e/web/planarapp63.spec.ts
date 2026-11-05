import { expect, test, type Page } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

// PLANARAPP-63: the side panel gone (another tab, Esc) — the screen gets its width back
const pad = (page: Page) => page.locator('main').evaluate((m) => getComputedStyle(m).paddingRight);

test('PLANARAPP-63: после закрытия боковой панели не остаётся пустого места', async ({
  browser,
}) => {
  const f = await fixture(['P63 task']);
  const page = await loginAs(browser, 'admin');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(() => localStorage.setItem('planar.taskOpen', 'side'));
  const panel = page.getByTestId('task-side');

  await page.goto(`/p/${f.projectId}/board?task=${f.taskKeys[0]}`);
  await expect(panel).toBeVisible();
  await expect.poll(() => pad(page)).toBe('896px');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect.poll(() => pad(page)).toBe('0px');

  // the panel of «Задачи» is drawn by the view: leaving the tab unmounts it together with ?task
  await page.goto(`/p/${f.projectId}/board?task=${f.taskKeys[0]}`);
  await expect(panel).toBeVisible();
  await page.getByRole('link', { name: 'Моя работа' }).first().click();
  await expect(page).toHaveURL(/\/work/);
  await expect(panel).toBeHidden();
  await expect.poll(() => pad(page)).toBe('0px');
});
