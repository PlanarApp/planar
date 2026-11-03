import { expect, test } from '@playwright/test';
import { ranks, uuidv7 } from '../lib.js';
import { fixture, loginAs, uniq } from './helpers.js';

// PJ-29: "select all" in the grouped list (default grouping — by status)

test('PJ-29: выбрать все и выбрать группу в сгруппированном списке', async ({ browser }) => {
  const f = await fixture([]);
  const titles = [uniq('Гр A'), uniq('Гр B'), uniq('Гр C')];
  const rk = ranks(titles.length);
  await f.admin.pushOk(
    titles.map((title, i) =>
      f.admin.mut('task.create', {
        id: uuidv7(),
        projectId: f.projectId,
        statusId: f.statusIds[i === 2 ? 1 : 0],
        title,
        rank: rk[i],
      }),
    ),
  );
  const page = await loginAs(browser, 'admin');
  await page.goto(`/p/${f.projectId}/list`);
  const bar = page.getByTestId('bulk-bar');
  // group checkbox: only its tasks
  await page.getByTestId('select-group').first().check();
  await expect(bar).toContainText('2');
  // general: all groups
  const all = page.getByTestId('select-all');
  await expect(all).toHaveJSProperty('indeterminate', true);
  await all.click();
  await expect(bar).toContainText('3');
  await all.click();
  await expect(bar).toHaveCount(0);
});
