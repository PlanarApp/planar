import { expect, test } from '@playwright/test';
import { fixture, loginAs, uniq } from './helpers.js';

// PJ-23: in the space "Tasks", List → Board → List opens List again
// PLNRAPP-71: views — buttons at the top of the «View» menu, no view tabs in «Tasks»
test('PJ-23: возврат на вид «Список» в Задачах пространства', async ({ browser }) => {
  const f = await fixture([uniq('Список')]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/s/${f.spaceId}/list`);
  await expect(page.getByTestId('view-tabs').getByRole('tab', { name: 'Доска' })).toHaveCount(0);
  const layout = page.getByTestId('view-layout');
  const pick = async (name: string) => {
    if (!(await layout.isVisible())) await page.getByTestId('view-toggle').click();
    await layout.getByRole('button', { name }).click();
  };
  await pick('Доска');
  await expect(page).toHaveURL(/\/board$/);
  await pick('Список');
  await expect(page).toHaveURL(/\/list$/);
  await expect(layout.getByRole('button', { name: 'Список' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
