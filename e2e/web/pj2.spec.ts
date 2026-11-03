import { expect, test } from '@playwright/test';
import { uuidv7 } from '../lib.js';
import { fixture, loginAs, pick, uniq } from './helpers.js';

// PJ-2: statuses and labels live in project settings; a summary groups same-named statuses of projects as one.

type Row = Record<string, unknown>;
const table = async (f: Awaited<ReturnType<typeof fixture>>, entity: string): Promise<Row[]> =>
  ((await f.admin.bootstrap()).data[entity] ?? []) as Row[];

test('PJ-2: настройки проекта — статус добавлен, скопирован из другого проекта; в пространстве разделов нет', async ({
  browser,
}) => {
  const f = await fixture([uniq('Задача')]);
  const src = { id: uuidv7(), key: 'SRC' + f.key.slice(0, 2) };
  const copyName = uniq('Скопировать');
  await f.admin.pushOk([
    f.admin.mut('project.create', {
      id: src.id,
      spaceId: f.spaceId,
      name: `E2E ${src.key}`,
      key: src.key,
      rank: 'a9',
      statusIds: Array.from({ length: 5 }, () => uuidv7()),
    }),
  ]);
  await f.admin.pushOk([
    f.admin.mut('status.create', {
      id: uuidv7(),
      projectId: src.id,
      name: copyName,
      category: 'in_progress',
      color: '#3366ff',
      rank: 'a9',
    }),
  ]);
  const page = await loginAs(browser, 'admin');

  // the space has no «Статусы»/«Метки» sections any more
  await page.goto(`/s/${f.spaceId}/settings`);
  await expect(page.getByTestId('nav-projects')).toBeVisible();
  await expect(page.getByTestId('nav-statuses')).toHaveCount(0);
  await expect(page.getByTestId('nav-labels')).toHaveCount(0);

  // the project has
  await page.goto(`/p/${f.projectId}/settings?s=statuses`);
  const added = uniq('Ревью');
  await page.getByTestId('status-new').fill(added);
  await page.getByTestId('status-new').press('Enter');
  await expect
    .poll(async () => (await table(f, 'statuses')).find((s) => s.name === added)?.projectId)
    .toBe(f.projectId);

  await pick(page.getByTestId('copy-from').getByRole('combobox'), `E2E ${src.key}`);
  await page.getByTestId('copy-go').click();
  await expect
    .poll(async () =>
      (await table(f, 'statuses')).filter((s) => s.name === copyName).map((s) => s.projectId),
    )
    .toContain(f.projectId);
  await expect(page.getByTestId('status-row').locator('input').first()).toBeVisible();
});

test('PJ-2: сводный список двух проектов — одноимённый статус одной группой', async ({
  browser,
}) => {
  const title1 = uniq('Первая');
  const f = await fixture([title1]);
  const other = uuidv7();
  const otherStatuses = Array.from({ length: 5 }, () => uuidv7());
  const title2 = uniq('Вторая');
  await f.admin.pushOk([
    f.admin.mut('project.create', {
      id: other,
      spaceId: f.spaceId,
      name: `E2E B${f.key}`,
      key: `B${f.key}`,
      rank: 'a9',
      statusIds: otherStatuses,
    }),
  ]);
  await f.admin.pushOk([
    f.admin.mut('task.create', {
      id: uuidv7(),
      projectId: other,
      statusId: otherStatuses[0],
      title: title2,
      rank: 'a0',
    }),
  ]);
  // both projects have a status with the same default name (first = backlog)
  const names = new Set(
    (await table(f, 'statuses'))
      .filter((s) => s.id === f.statusIds[0] || s.id === otherStatuses[0])
      .map((s) => String(s.name).toLowerCase()),
  );
  expect(names.size).toBe(1);

  const page = await loginAs(browser, 'alice');
  await page.goto(`/s/${f.spaceId}/list`);
  await expect(page.getByText(title2)).toBeVisible();
  await expect(page.getByText(title1)).toBeVisible();
  // one group per status name; both tasks fall into it
  const groups = page.getByTestId('group-row').filter({ hasText: [...names][0]! });
  await expect(groups).toHaveCount(1);
  await expect(groups.first()).toContainText('2');
});
