import { expect, test } from '@playwright/test';
import { ranks, uuidv7 } from '../lib.js';
import { fixture, loginAs } from './helpers.js';

// PLNRAPP-113: сохранённый вид открывает задачу окном (не страницей), смена раскладки остаётся в виде
test('PLNRAPP-113: задача окном в сохранённом виде, раскладка — черновик вида', async ({
  browser,
}) => {
  const f = await fixture(['PLNRAPP113 один']);
  const viewId = uuidv7();
  await f.admin.pushOk([
    f.admin.mut('view.create', {
      id: viewId,
      spaceId: f.spaceId,
      personal: true,
      name: 'Мой вид 113',
      layout: 'list',
      filter: { op: 'and', rules: [] },
      config: {},
      rank: ranks(1)[0],
    }),
  ]);
  const page = await loginAs(browser, 'admin');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(() => localStorage.setItem('planar.taskOpen', 'modal'));
  await page.goto(`/p/${f.projectId}/v/${viewId}`);
  const viewUrl = new RegExp(`/v/${viewId}`);
  const modal = page.getByTestId('task-modal');

  await page.locator(`[role=row][data-task="${f.taskKeys[0]}"]`).click();
  await expect(modal).toContainText(f.taskKeys[0]);
  await expect(page).toHaveURL(viewUrl);
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();

  // доска — в том же виде; «Сохранить» записывает раскладку
  const layout = page.getByTestId('view-layout');
  if (!(await layout.isVisible())) await page.getByTestId('view-toggle').click();
  await layout.getByRole('button', { name: 'Доска' }).click();
  await expect(page).toHaveURL(viewUrl);
  await expect(layout.getByRole('button', { name: 'Доска' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await page.getByText('PLNRAPP113 один').click();
  await expect(modal).toContainText(f.taskKeys[0]);
  await expect(page).toHaveURL(viewUrl);
  await page.keyboard.press('Escape');
  await page.getByTestId('saved-save').click();
  await expect(page.getByTestId('view-changes')).toBeHidden();
  // перезагрузка — когда правка дошла до сервера
  await expect
    .poll(async () => {
      const { data } = await f.admin.bootstrap();
      const views = (data as unknown as { savedViews: { id: string; layout: string }[] })
        .savedViews;
      return views.find((v) => v.id === viewId)?.layout;
    })
    .toBe('board');
  await page.reload();
  if (!(await layout.isVisible())) await page.getByTestId('view-toggle').click();
  await expect(layout.getByRole('button', { name: 'Доска' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
