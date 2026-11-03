import { expect, test } from '@playwright/test';
import { fixture, loginAs, uniq } from './helpers.js';

// PJ-5: a label that does not exist is created from the task's label picker and assigned at once.

test('PJ-5: «Создать «…»» в выборе меток задачи создаёт метку в проекте и назначает её', async ({
  browser,
}) => {
  const title = uniq('Задача');
  const f = await fixture([title]);
  const name = uniq('метка');
  const page = await loginAs(browser, 'admin');
  await page.goto(`/s/${f.spaceId}/list`);
  // the list shows titles, not keys
  await page.getByText(title).first().click();
  await page.getByRole('button', { name: 'Метки' }).first().click();
  await page.getByRole('textbox', { name: 'Метки' }).fill(name);
  await page.getByRole('option', { name: `Создать «${name}»` }).click();
  await expect(page.getByRole('button', { name: 'Метки' }).first()).toContainText(name);
  // the UI shows the label optimistically: wait for it to reach the server
  await expect
    .poll(
      async () => (await f.admin.bootstrap()).data.labels?.find((l) => l.name === name)?.projectId,
    )
    .toBe(f.projectId);
  const d = (await f.admin.bootstrap()).data;
  const label = d.labels!.find((l) => l.name === name);
  expect(d.taskLabels?.some((tl) => tl.labelId === label?.id)).toBe(true);
});
