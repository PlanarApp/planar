import { expect, test } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

// PJ-30: the Table has the «Колонки» menu; «Начало» can be shown; the choice survives reload

test('pj30: меню «Колонки» — показать «Начало», скрыть «Ключ»; переживает reload', async ({
  browser,
}) => {
  const f = await fixture([]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/p/${f.projectId}/table`);
  const col = (id: string) => page.locator(`[role=columnheader][data-col="${id}"]`);
  await expect(col('startDate')).toHaveCount(0);
  await page.getByRole('button', { name: 'Колонки', exact: true }).click();
  await page.getByLabel('Начало', { exact: true }).check();
  await page.getByLabel('Ключ', { exact: true }).uncheck();
  await expect(col('startDate')).toBeVisible();
  await expect(col('key')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(col('startDate')).toBeVisible();
  await expect(col('key')).toHaveCount(0);
});
