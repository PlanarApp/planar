import { expect, test } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

// PJ-25: filters are not printed as text; the filter button carries a mark and a tooltip

test('pj25: непустой фильтр — отметка и подсказка на кнопке, чипов нет', async ({ browser }) => {
  const f = await fixture([]);
  const page = await loginAs(browser, 'admin');
  await page.goto(`/p/${f.projectId}/board`);
  const btn = page.getByTestId('filter-toggle');
  await expect(btn).toBeVisible();
  await expect(page.getByTestId('filter-active')).toHaveCount(0);
  await btn.click();
  await page.locator('[data-role=add]').click();
  await expect(page.getByTestId('filter-active')).toHaveCount(1);
  await expect(btn).toHaveAttribute('title', /.+/);
  await expect(page.getByTestId('filter-chip')).toHaveCount(0);
});
