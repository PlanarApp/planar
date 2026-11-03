import { expect, test } from '@playwright/test';
import { fixture, loginAs, uniq } from './helpers.js';

// PJ-21: the Save/Reset buttons appear without moving the "View" menu
test('PJ-21: кнопка «Вид» не сдвигается при появлении «Сбросить»', async ({ browser }) => {
  const f = await fixture([uniq('Вид')]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/p/${f.projectId}/list`);
  const toggle = page.getByTestId('view-toggle');
  await expect(toggle).toBeVisible();
  await expect(page.getByTestId('node-reset')).toHaveCount(0);
  const before = await toggle.boundingBox();

  await toggle.click();
  await page.locator('[data-field=labels]').uncheck();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('node-reset')).toBeVisible();

  const after = await toggle.boundingBox();
  expect(after?.x).toBe(before?.x);
  expect(after?.y).toBe(before?.y);
});
