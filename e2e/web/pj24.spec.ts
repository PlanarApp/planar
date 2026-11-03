import { expect, test } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

// PJ-24: the board scrolls horizontally by dragging an empty spot with the mouse

test('PJ-24: доска прокручивается перетаскиванием за пустое место', async ({ browser }) => {
  const f = await fixture([]);
  const page = await loginAs(browser, 'admin');
  await page.setViewportSize({ width: 500, height: 700 });
  await page.goto(`/p/${f.projectId}/board`);
  const board = page.getByRole('group', { name: 'Доска' });
  await expect(board).toBeVisible();
  expect(await board.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0);
  const box = (await board.boundingBox())!;
  // the padding strip at the bottom edge belongs to the board, not to a column
  const y = box.y + box.height - 4;
  await page.mouse.move(box.x + 300, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, y, { steps: 5 });
  await page.mouse.up();
  expect(await board.evaluate((el) => el.scrollLeft)).toBeGreaterThan(50);
});
