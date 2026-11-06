import { expect, test } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

// PLNRAPP-101: Esc закрывает открытый выбор, а окно задачи — только когда поверх ничего нет
test('PLNRAPP-101: Enter → s → Esc закрывает только выбор статуса', async ({ browser }) => {
  const f = await fixture(['PLNRAPP101 один', 'PLNRAPP101 два']);
  const page = await loginAs(browser, 'admin');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(() => localStorage.setItem('planar.taskOpen', 'modal'));
  await page.goto(`/p/${f.projectId}/list`);
  await expect(page.locator(`[role=row][data-task="${f.taskKeys[0]}"]`)).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('j');
  await page.keyboard.press('Enter');
  const modal = page.getByTestId('task-modal');
  await expect(modal).toContainText(f.taskKeys[0]);
  await page.keyboard.press('s');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});
