import { expect, test } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

// PJ-18: the sidebar is resizable by mouse; the width is remembered, clamped to 200..480
test('PJ-18: сайдбар тянется мышью, ширина зажата и запоминается', async ({ browser }) => {
  await fixture([]);
  const page = await loginAs(browser, 'admin');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const aside = page.locator('aside.sidebar-dark').first();
  const handle = page.getByTestId('sidebar-resize');
  await expect(handle).toBeVisible();
  const width = async () => Math.round((await aside.boundingBox())!.width);
  await expect.poll(width).toBe(240);

  const drag = async (to: number) => {
    const b = (await handle.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + 200);
    await page.mouse.down();
    await page.mouse.move(to, b.y + 200, { steps: 5 });
    await page.mouse.up();
  };

  await drag(320);
  await expect.poll(width).toBe(320);
  await drag(1000);
  await expect.poll(width).toBe(480);
  await drag(5);
  await expect.poll(width).toBe(200);

  await drag(300);
  await page.reload();
  await expect(aside).toBeVisible();
  await expect.poll(width).toBe(300);
});
