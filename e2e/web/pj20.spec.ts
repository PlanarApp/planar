import { expect, test } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

// PJ-20: the sidebar collapses to a rail or hides; the mode is remembered; one click restores it
test('PJ-20: сайдбар сворачивается в полосу, скрывается и возвращается; режим запоминается', async ({
  browser,
}) => {
  await fixture([]);
  const page = await loginAs(browser, 'admin');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const width = async (id: string) => Math.round((await page.getByTestId(id).boundingBox())!.width);

  await expect(page.getByTestId('sidebar')).toBeVisible();
  await page.getByTestId('sidebar-collapse').click();
  await expect(page.getByTestId('sidebar')).toHaveCount(0);
  await expect.poll(() => width('sidebar-rail')).toBe(56);

  await page.reload();
  await expect(page.getByTestId('sidebar-rail')).toBeVisible();

  await page.getByTestId('sidebar-hide').click();
  await expect(page.getByTestId('sidebar-rail')).toHaveCount(0);
  await expect(page.getByTestId('sidebar')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('sidebar-show')).toBeVisible();

  await page.getByTestId('sidebar-show').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByTestId('sidebar-show')).toHaveCount(0);
});
