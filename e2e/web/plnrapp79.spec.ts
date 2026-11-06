import { expect, test } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

// PLNRAPP-79: боковой лист — j/k в Списке и в самом листе сразу меняют задачу; f — фильтр вида
test('PLNRAPP-79: j/k листают задачи в боковом листе, f открывает фильтр', async ({ browser }) => {
  const f = await fixture(['PLNRAPP79 один', 'PLNRAPP79 два', 'PLNRAPP79 три']);
  const page = await loginAs(browser, 'admin');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(() => localStorage.setItem('planar.taskOpen', 'side'));
  await page.goto(`/p/${f.projectId}/list`);
  const taskOf = () => new URL(page.url()).searchParams.get('task');
  const first = page.locator(`[role=row][data-task="${f.taskKeys[0]}"]`);
  await first.click();
  await expect(page.getByTestId('task-side')).toBeVisible();
  await expect.poll(taskOf).toBe(f.taskKeys[0]);
  const history = await page.evaluate(() => history.length);

  // фокус в списке: j — следующая задача в листе, без новой записи истории
  await page.keyboard.press('j');
  await expect.poll(taskOf).not.toBe(f.taskKeys[0]);
  const second = taskOf()!;
  await expect(page.getByTestId('task-side')).toContainText(second);
  expect(await page.evaluate(() => history.length)).toBe(history);

  // фокус вне списка (в листе или нигде): k — обратно
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('k');
  await expect.poll(taskOf).toBe(f.taskKeys[0]);

  await page.keyboard.press('f');
  await expect(page.getByTestId('filter-toggle')).toHaveAttribute('aria-expanded', 'true');
});
