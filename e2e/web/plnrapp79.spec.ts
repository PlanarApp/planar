import { expect, test } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

// PLNRAPP-79: боковой лист — j/k в Списке и в самом листе сразу меняют задачу; f — быстрый фильтр вида
test('PLNRAPP-79: j/k листают задачи в боковом листе, f — быстрый фильтр', async ({ browser }) => {
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

  // f — поле быстрого фильтра: список фильтруется по мере ввода, Delete сбрасывает
  const rows = page.locator('[role=row][data-task]');
  await expect(rows).toHaveCount(3);
  await page.keyboard.press('f');
  const quick = page.getByTestId('quick-filter');
  await expect(quick).toBeFocused();
  await page.keyboard.type('дв');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('PLNRAPP79 два');
  await expect(page.getByTestId('filter-active')).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(quick).toBeHidden();
  await expect(rows).toHaveCount(3);
});

// PLNRAPP-79: клавиши задачи — s статус, a исполнитель, m комментарий, d «Мой день»;
// фокус ушёл со списка (на страницу) — клавиши списка всё равно работают
test('PLNRAPP-79: s/a/m/d на задаче, в Списке и в боковом листе', async ({ browser }) => {
  const f = await fixture(['PLNRAPP79k один', 'PLNRAPP79k два']);
  const page = await loginAs(browser, 'admin');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(() => localStorage.setItem('planar.taskOpen', 'side'));
  await page.goto(`/p/${f.projectId}/list`);
  const first = page.locator(`[role=row][data-task="${f.taskKeys[0]}"]`);
  await expect(first).toBeVisible();

  // фокус нигде: j — фокус в список на первую задачу, d — в «Мой день», s — пикер статуса строки
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('j');
  await page.keyboard.press('d');
  await expect(first.getByTestId('row-in-day')).toBeVisible();
  await page.keyboard.press('s');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();

  // боковой лист: a — пикер исполнителя, d — убрать из «Моего дня», m — поле комментария
  await page.keyboard.press('Enter');
  const side = page.getByTestId('task-side');
  await expect(side).toContainText(f.taskKeys[0]);
  await page.keyboard.press('a');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await page.keyboard.press('d');
  await expect(first.getByTestId('row-in-day')).toBeHidden();
  await page.keyboard.press('m');
  await expect(side.locator('[contenteditable=true]:focus')).toBeVisible();
});
