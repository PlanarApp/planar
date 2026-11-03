import { expect, test } from '@playwright/test';
import { Client } from '../lib.js';
import { fixture, loginAs, uniq } from './helpers.js';

test('PJ-11: без перекрытия состав проекта = пространству; убранный участник не видит проект', async ({
  browser,
}) => {
  const title = uniq('PJ11 задача');
  const f = await fixture([title]);
  const bob = await Client.login('bob');
  const bobName = (await f.admin.bootstrap()).data.users!.find((u) => u.id === bob.userId)!.name;
  const hasProject = async () =>
    (await bob.bootstrap()).data.projects!.some((p) => p.id === f.projectId);
  expect(await hasProject()).toBe(true);

  const page = await loginAs(browser, 'admin');
  await page.goto(`/p/${f.projectId}/settings?s=projectMembers`);
  const rows = page.getByTestId('pmember-row');
  // inherit: the space's composition (admin is not a space member here: alice, bob), read-only for the list
  await expect(page.getByTestId('mode-inherit')).toBeChecked();
  await expect(rows).toHaveCount(
    (await f.admin.bootstrap()).data.spaceMembers!.filter((m) => m.spaceId === f.spaceId).length,
  );
  await expect(page.getByTestId('row-menu')).toHaveCount(0);

  // «Свой состав» → remove bob
  await page.getByTestId('mode-custom').check();
  await expect(page.getByTestId('pmember-add')).toBeVisible();
  const row = rows.filter({ hasText: bobName });
  await row.getByTestId('row-menu').click();
  await page.getByRole('menuitem', { name: 'Убрать' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Убрать' }).click();
  await expect(row).toHaveCount(0);

  await expect.poll(hasProject).toBe(false);
  expect(
    (await bob.bootstrap()).data.tasks!.filter((t) => t.projectId === f.projectId),
  ).toHaveLength(0);

  // back to «Как в пространстве»: bob sees the project again
  await page.getByTestId('mode-inherit').check();
  await expect(rows.filter({ hasText: bobName })).toHaveCount(1);
  await expect.poll(hasProject).toBe(true);
});
