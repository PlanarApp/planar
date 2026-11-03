import { expect, test } from '@playwright/test';
import { Client, ranks, uuidv7 } from '../lib.js';
import { fixture, loginAs, uniq } from './helpers.js';

// PJ-12: unchecking an assignee in the bulk bar removes him from all selected tasks

test('PJ-12: массовая панель — снять исполнителя сразу у нескольких задач', async ({ browser }) => {
  const f = await fixture([]);
  const alice = await Client.login('alice');
  const titles = [uniq('Массовая A'), uniq('Массовая B')];
  const ids = titles.map(() => uuidv7());
  const rk = ranks(titles.length);
  await f.admin.pushOk(
    titles.map((title, i) =>
      f.admin.mut('task.create', {
        id: ids[i],
        projectId: f.projectId,
        statusId: f.statusIds[0],
        title,
        rank: rk[i],
        assignees: [{ id: uuidv7(), userId: alice.userId }],
      }),
    ),
  );
  const assigned = async () =>
    (((await f.admin.bootstrap()).data.taskAssignees ?? []) as { taskId: string }[]).filter((a) =>
      ids.includes(a.taskId),
    ).length;
  expect(await assigned()).toBe(2);

  const page = await loginAs(browser, 'admin');
  await page.goto(`/p/${f.projectId}/list`);
  for (const title of titles) {
    await page
      .getByRole('row', { name: new RegExp(title) })
      .getByLabel('Выбрать задачу')
      .check();
  }
  const bar = page.getByTestId('bulk-bar');
  await bar.getByRole('button', { name: 'Исполнитель' }).click();
  const alice_opt = page.getByRole('option', { name: /alice/i });
  await expect(alice_opt).toHaveAttribute('aria-selected', 'true');
  await alice_opt.click();
  await expect.poll(assigned).toBe(0);
});
