import { expect, test } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

test('PJ-14: новый проект создаётся с включёнными модулями данных; в настройках проекта они отмечены', async ({
  browser,
}) => {
  const f = await fixture([]);
  const page = await loginAs(browser, 'admin');
  const key = `Q${Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X')}`;
  await page.goto(`/s/${f.spaceId}/settings?s=projects`);
  await page.getByTestId('project-name').fill(`PJ14 ${key}`);
  await page.getByTestId('project-key').fill(key);
  await page.getByRole('main').getByRole('button', { name: 'Создать', exact: true }).click();

  let projectId = '';
  await expect
    .poll(async () => {
      const p = (await f.admin.bootstrap()).data.projects!.find((x) => x.key === key);
      projectId = p?.id ?? '';
      return (p?.modules as string[] | undefined)?.includes('time');
    })
    .toBe(true);

  await page.goto(`/p/${projectId}/settings?s=modules`);
  const row = page.locator('[data-testid=module-row][data-module=time]');
  await expect(row).toBeVisible();
  await expect(row.getByRole('switch')).toBeChecked();
});
