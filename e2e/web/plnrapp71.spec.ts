import { expect, test } from '@playwright/test';
import { loginAs } from './helpers.js';

// PLNRAPP-71/84: «Моя работа» — разделы табами, первым «Мой день»; вид задач — вверху меню «Вид»
test('PLNRAPP-71: табы разделов «Моей работы», вид — в меню «Вид»', async ({ browser }) => {
  const page = await loginAs(browser, 'alice');
  await page.goto('/w/work');
  const tabs = page.getByTestId('work-tabs');
  await expect(tabs.getByRole('tab', { name: 'Мой день' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('work-menu')).toHaveCount(0);
  await tabs.getByRole('tab', { name: 'Назначенные' }).click();
  await expect(page).toHaveURL(/w=assigned/);
  // табов видов нет — только разделы
  await expect(tabs.getByRole('tab', { name: 'Доска' })).toHaveCount(0);
  await page.getByTestId('view-toggle').click();
  await page.getByTestId('view-options').getByRole('combobox', { name: 'Вид' }).click();
  await page.getByRole('option', { name: 'Доска' }).click();
  await expect(page).toHaveURL(/v=board/);
  // разделы без вида задач — те же табы
  await tabs.getByRole('tab', { name: 'Комментарии мне' }).click();
  await expect(page).toHaveURL(/w=comments/);
  await expect(page.getByTestId('work-tabs')).toBeVisible();
});
