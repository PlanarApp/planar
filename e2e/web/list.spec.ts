import { expect, test, type Page } from '@playwright/test';
import { fixture, loginAs, uniq } from './helpers.js';

// List as in ClickUp: subtasks as a tree, collapsing, dragging into subtasks and back.

const OPTS = {
  groupBy: 'none',
  sortBy: 'rank',
  sortDir: 'asc',
  showSubtasks: true,
  fields: ['status', 'assignee', 'priority', 'dueDate', 'labels'],
};

async function drag(page: Page, src: string, dst: string, frac: number) {
  const row = (k: string) => page.locator(`[role=row][data-task="${k}"]`);
  await row(src).hover();
  const g = (await row(src).getByTestId('row-grip').boundingBox())!;
  const d = (await row(dst).boundingBox())!;
  await page.mouse.move(g.x + 5, g.y + 5);
  await page.mouse.down();
  const ty = d.y + d.height * frac;
  for (let i = 1; i <= 12; i++) await page.mouse.move(g.x + 5, g.y + 5 + ((ty - g.y - 5) * i) / 12);
  await page.mouse.up();
}

test('перетаскивание: в подзадачи (середина строки) и обратно (граница), сворачивание', async ({
  browser,
}) => {
  const f = await fixture([uniq('Родитель'), uniq('Ребёнок'), uniq('Третья')]);
  const [parent, child, third] = f.taskKeys as [string, string, string];
  const page = await loginAs(browser, 'alice');
  await page.evaluate(([p, o]) => localStorage.setItem(`planar.view.${p}.list`, o), [
    f.projectId,
    JSON.stringify(OPTS),
  ] as const);
  await page.goto(`/p/${f.projectId}`);
  const row = (k: string) => page.locator(`[role=row][data-task="${k}"]`);
  await expect(row(third)).toBeVisible();

  await drag(page, child, parent, 0.5); // into
  await expect(row(parent).getByTestId('row-children')).toHaveText('1');

  await row(parent).getByTestId('row-fold').click();
  await expect(row(child)).toHaveCount(0);
  await row(parent).getByTestId('row-fold').click();
  await expect(row(child)).toBeVisible();

  await drag(page, child, third, 0.02); // out, before the third
  await expect(row(parent).getByTestId('row-children')).toHaveCount(0);
  await page.reload();
  await expect(row(child)).toBeVisible();
  await expect(row(parent).getByTestId('row-children')).toHaveCount(0);
  const order = await page
    .locator('[role=row][data-task]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-task')));
  expect(order.indexOf(child)).toBe(order.indexOf(third) - 1);
});
