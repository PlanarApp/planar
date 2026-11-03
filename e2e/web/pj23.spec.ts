import { expect, test } from '@playwright/test';
import { fixture, loginAs, uniq } from './helpers.js';

// PJ-23: in the space "Tasks", List → Board → List opens List again
test('PJ-23: возврат на вид «Список» в Задачах пространства', async ({ browser }) => {
  const f = await fixture([uniq('Список')]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/s/${f.spaceId}/list`);
  const tabs = page.getByTestId('view-tabs');
  await tabs.getByRole('tab', { name: 'Доска' }).click();
  await expect(page).toHaveURL(/\/board$/);
  await tabs.getByRole('tab', { name: 'Список' }).click();
  await expect(page).toHaveURL(/\/list$/);
  await expect(tabs.getByRole('tab', { name: 'Список' })).toHaveAttribute('aria-selected', 'true');
});
