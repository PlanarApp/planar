import { expect, test } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

// PLANARAPP-62: with wrapped names the List still drags tasks, service rows keep their height
test('PLANARAPP-62: перенос по словам — перетаскивание и высота заголовков', async ({
  browser,
}) => {
  const long = 'Длинное название задачи, которое не помещается в одну строку списка '.repeat(3);
  const f = await fixture([`P62 A ${long}`, 'P62 B', 'P62 C']);
  const page = await loginAs(browser, 'admin');
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/p/${f.projectId}/list`);
  const row = (k: string) => page.locator(`[role=row][data-task="${k}"]`);
  await expect(row(f.taskKeys[2])).toBeVisible();
  await page.getByRole('button', { name: 'Вид' }).click();
  await page.getByText('Переносить названия').click();
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await row(f.taskKeys[0]).boundingBox())!.height)
    .toBeGreaterThan(40);
  // group header — the row height, as without wrapping
  const head = page.getByRole('row').filter({ hasText: 'Backlog' }).first();
  expect(Math.round((await head.boundingBox())!.height)).toBe(32);

  // C above B: the drop slot is found by the measured rows, not by the fixed row height
  await row(f.taskKeys[2]).hover();
  const g = (await row(f.taskKeys[2]).getByTestId('row-grip').boundingBox())!;
  const d = (await row(f.taskKeys[1]).boundingBox())!;
  await page.mouse.move(g.x + 5, g.y + 5);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(g.x + 5, g.y + 5 + ((d.y + 2 - g.y - 5) * i) / 12);
  await page.mouse.up();
  await expect
    .poll(async () =>
      (await page.locator('[role=row][data-task]').allTextContents()).map((t) => t.slice(0, 5)),
    )
    .toEqual(['P62 A', 'P62 C', 'P62 B']);
});
