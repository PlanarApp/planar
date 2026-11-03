import { expect, test } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

// PJ-19: the task side panel is resizable by mouse; the width is remembered, clamped to 400..1400
test('PJ-19: боковая панель задачи тянется мышью, ширина зажата и запоминается', async ({
  browser,
}) => {
  const f = await fixture(['PJ19 task']);
  const page = await loginAs(browser, 'admin');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(() => localStorage.setItem('planar.taskOpen', 'side'));
  await page.goto(`/p/${f.projectId}?task=${f.taskKeys[0]}`);
  const panel = page.getByTestId('task-side');
  const handle = page.getByTestId('task-side-resize');
  await expect(handle).toBeVisible();
  const width = async () => Math.round((await panel.boundingBox())!.width);
  await expect.poll(width).toBe(896);

  const drag = async (toX: number) => {
    const b = (await handle.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + 200);
    await page.mouse.down();
    await page.mouse.move(toX, b.y + 200, { steps: 5 });
    await page.mouse.up();
  };

  await drag(1600 - 600);
  await expect.poll(width).toBe(600);
  await drag(5);
  await expect.poll(width).toBe(1400);
  await drag(1590);
  await expect.poll(width).toBe(400);

  await drag(1600 - 700);
  await page.reload();
  await expect(panel).toBeVisible();
  await expect.poll(width).toBe(700);
});
