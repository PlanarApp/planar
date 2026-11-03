import { expect, test } from '@playwright/test';
import { ranks, uuidv7 } from '../lib.js';
import { fixture, loginAs, uniq } from './helpers.js';

// PJ-22: "select all" checkbox in the list header and the table header

test('PJ-22: выбрать все в списке и в таблице', async ({ browser }) => {
  const f = await fixture([]);
  const titles = [uniq('Все A'), uniq('Все B'), uniq('Все C')];
  const rk = ranks(titles.length);
  await f.admin.pushOk(
    titles.map((title, i) =>
      f.admin.mut('task.create', {
        id: uuidv7(),
        projectId: f.projectId,
        statusId: f.statusIds[0],
        title,
        rank: rk[i],
      }),
    ),
  );
  // the "select all" header exists only without grouping (by default the list is grouped by status)
  await f.admin.pushOk([
    f.admin.mut('view.create', {
      id: uuidv7(),
      spaceId: f.spaceId,
      personal: true,
      name: 'list',
      layout: 'list',
      node: `p:${f.projectId}`,
      filter: { op: 'and', rules: [] },
      config: {
        groupBy: 'none',
        sortBy: 'rank',
        sortDir: 'asc',
        showSubtasks: true,
        fields: ['status', 'assignee', 'priority', 'dueDate', 'labels'],
      },
      rank: ranks(1)[0],
    }),
  ]);
  const page = await loginAs(browser, 'admin');
  await page.goto(`/p/${f.projectId}/list`);
  const all = page.getByTestId('select-all');
  await all.check();
  await expect(page.getByTestId('bulk-bar')).toContainText('3');
  await page
    .getByRole('row', { name: new RegExp(titles[0]!) })
    .getByLabel('Выбрать задачу')
    .uncheck();
  await expect(all).toHaveJSProperty('indeterminate', true);
  await all.click();
  await all.click();
  await expect(page.getByTestId('bulk-bar')).toHaveCount(0);

  await page.goto(`/p/${f.projectId}/table`);
  await expect(page.getByRole('row', { name: new RegExp(titles[2]!) })).toBeVisible();
  await page.getByTestId('select-all').check();
  await expect(page.getByRole('toolbar', { name: /3/ })).toBeVisible();
});
