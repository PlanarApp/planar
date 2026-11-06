import { expect, test } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

// PJ-30: the Table columns are chosen in the «Вид» menu (PLNRAPP-83); «Начало» can be shown; the choice survives reload

test('pj30: меню «Вид» › «Колонки» — показать «Начало», скрыть «Ключ»; переживает reload', async ({
  browser,
}) => {
  const f = await fixture([]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/p/${f.projectId}/table`);
  const col = (id: string) => page.locator(`[role=columnheader][data-col="${id}"]`);
  await expect(col('startDate')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Колонки', exact: true })).toHaveCount(0);
  await page.getByTestId('view-toggle').click();
  const menu = page.getByTestId('table-columns');
  await menu.getByLabel('Начало', { exact: true }).check();
  await menu.getByLabel('Ключ', { exact: true }).uncheck();
  await expect(col('startDate')).toBeVisible();
  await expect(col('key')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(col('startDate')).toBeVisible();
  await expect(col('key')).toHaveCount(0);
});
