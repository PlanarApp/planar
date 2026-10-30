import { expect, test } from '@playwright/test';
import { fixture, loginAs, uniq } from './helpers.js';

// Menus and quick create (ClickUp level): right click on a task, '+ Create', project menu.
// statusIds of the fixture: [backlog, todo, in_progress, done, cancelled] — default status names (en).

test('правый клик по задаче: статус через подменю, переживает reload', async ({ browser }) => {
  const title = uniq('Меню');
  const f = await fixture([title]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/p/${f.projectId}`);
  const row = page.getByRole('row').filter({ hasText: title });
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Статус' }).hover();
  await page.getByRole('menuitem', { name: 'Done' }).click();
  await page.reload();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Статус' }).hover();
  // mark of the current status — on Done
  await expect(page.getByRole('menuitem', { name: 'Done' }).locator('svg').last()).toBeVisible();
});

test('«+ Создать» → задача: создаётся с одного клика, без дублей', async ({ browser }) => {
  const f = await fixture([]);
  const page = await loginAs(browser, 'alice');
  const title = uniq('Быстрая');
  await page.goto(`/p/${f.projectId}`);
  await page.getByTestId('create-menu').click();
  await page.getByRole('menuitem', { name: /Задача/ }).click();
  await page.getByTestId('quick-title').fill(title);
  await page.getByTestId('quick-submit').click();
  await expect(page.getByTestId('quick-title')).toHaveCount(0);
  await page.goto(`/p/${f.projectId}`);
  await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(1);
});

test('боковая панель: новый проект через «+» и переименование через меню', async ({ browser }) => {
  await fixture([]);
  const page = await loginAs(browser, 'admin');
  const name = uniq('Проект');
  const space = page.getByTestId('nav-space').first();
  await space.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Новый проект' }).click();
  await page.getByPlaceholder('Название проекта').fill(name);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/p\//);
  const item = page.getByTestId('nav-project').filter({ hasText: name });
  await item.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Переименовать' }).click();
  const input = page.getByTestId('sidebar').getByLabel('Переименовать');
  await expect(input).toBeFocused();
  await input.fill(`${name} 2`);
  await input.press('Enter');
  await expect(page.getByTestId('nav-project').filter({ hasText: `${name} 2` })).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('nav-project').filter({ hasText: `${name} 2` })).toHaveCount(1);
});

test('баг DataCloneError: правило автоматизации создаётся с первого клика и одно', async ({
  browser,
}) => {
  const f = await fixture([]);
  const { enableModules } = await import('./work-helpers.js');
  const { Client } = await import('../lib.js');
  await enableModules(await Client.login('admin'));
  const page = await loginAs(browser, 'admin');
  const name = uniq('Правило');
  await page.goto(`/settings/automations:rules?project=${f.projectId}`);
  await page.locator('[data-role=new]').click();
  const ed = page.getByTestId('editor');
  await ed.getByLabel('Название').first().fill(name);
  const fields = ed.locator('textarea, input[type=text]');
  for (let i = 1; i < (await fields.count()); i++)
    if (!(await fields.nth(i).inputValue())) await fields.nth(i).fill('ok');
  await ed.locator('[data-role=save]').click();
  await expect(ed).toHaveCount(0);
  await expect(page.locator('[data-role=rule]').filter({ hasText: name })).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-role=rule]').filter({ hasText: name })).toHaveCount(1);
});
