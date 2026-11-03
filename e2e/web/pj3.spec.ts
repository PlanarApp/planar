import { expect, test } from '@playwright/test';
import { ranks, uuidv7 } from '../lib.js';
import { fixture, loginAs, uniq } from './helpers.js';
import { spa } from './p4-helpers.js';

const letters = () =>
  Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join(
    '',
  );

/** Second project in the fixture's space, without data modules, with one task. */
async function bareProject(f: Awaited<ReturnType<typeof fixture>>, title: string) {
  const projectId = uuidv7();
  const key = letters();
  const statusIds = Array.from({ length: 5 }, () => uuidv7());
  const taskId = uuidv7();
  const [rp, rt] = ranks(2);
  await f.admin.pushOk([
    f.admin.mut('project.create', {
      id: projectId,
      spaceId: f.spaceId,
      name: `E2E ${key}`,
      key,
      rank: rp,
      statusIds,
    }),
    f.admin.mut('task.create', { id: taskId, projectId, statusId: statusIds[0], title, rank: rt }),
  ]);
  const { data } = await f.admin.bootstrap();
  return { projectId, taskKey: `${key}-${data.tasks!.find((t) => t.id === taskId)!.number}` };
}

const timeTab = (page: import('@playwright/test').Page) =>
  page.getByRole('tab', { name: 'Время', exact: true });

test('PJ-3: модуль включён в одном проекте и не виден в другом; включение в настройках проекта', async ({
  browser,
}) => {
  const titleA = uniq('PJ3 задача');
  const titleB = uniq('PJ3 без модуля');
  const f = await fixture([titleA]);
  const b = await bareProject(f, titleB);
  const page = await loginAs(browser, 'admin');
  // client-side navigation: the module stays loaded, so only the project decides whether the panel shows
  const openTask = (key: string) =>
    spa(page, `/t/${key}`, page.getByText(key, { exact: true }).first());

  // project A: the fixture turned all data modules on — the «Время» panel is in the task
  await page.goto(`/t/${f.taskKeys[0]}`);
  await expect(timeTab(page)).toBeVisible();
  // project B: the module is off — no panel
  await openTask(b.taskKey);
  await expect(timeTab(page)).toHaveCount(0);

  // the mutator of the module in project B is rejected
  const res = await f.admin.push([
    f.admin.mut('time.start', { id: uuidv7(), taskId: await taskIdOf(f, b.taskKey) }),
  ]);
  expect(res[0]).toMatchObject({ ok: false, code: 'conflict' });

  // project settings → «Модули»: admin switches time on, the panel appears; off again — it disappears
  await spa(
    page,
    `/p/${b.projectId}/settings?s=modules`,
    page.locator('[data-testid=module-row][data-module=time]'),
  );
  const row = page.locator('[data-testid=module-row][data-module=time]');
  await row.getByRole('switch').check();
  await expect
    .poll(async () => {
      const p = (await f.admin.bootstrap()).data.projects!.find((x) => x.id === b.projectId);
      return (p?.modules as string[] | undefined)?.includes('time');
    })
    .toBe(true);
  await openTask(b.taskKey);
  await expect(timeTab(page)).toBeVisible();
  await spa(
    page,
    `/p/${b.projectId}/settings?s=modules`,
    page.locator('[data-testid=module-row][data-module=time]'),
  );
  await page.locator('[data-testid=module-row][data-module=time]').getByRole('switch').uncheck();
  await expect
    .poll(async () => {
      const p = (await f.admin.bootstrap()).data.projects!.find((x) => x.id === b.projectId);
      return (p?.modules as string[] | undefined)?.includes('time');
    })
    .toBe(false);
  await openTask(b.taskKey);
  await expect(timeTab(page)).toHaveCount(0);
});

test('PJ-3: общие модули — на странице админа экземпляра, в настройках Workspace раздела «Модули» нет', async ({
  browser,
}) => {
  const admin = await loginAs(browser, 'admin');
  await admin.goto('/w/settings');
  await expect(admin.getByTestId('nav-general')).toBeVisible();
  await expect(admin.getByTestId('nav-modules')).toHaveCount(0);
  await admin.goto('/admin/modules');
  const rows = admin.getByTestId('module-row');
  await expect(rows.first()).toBeVisible();
  await expect(admin.locator('[data-testid=module-row][data-module=chat]')).toBeVisible();
  await expect(admin.locator('[data-testid=module-row][data-module=time]')).toHaveCount(0);

  // not an admin: no link in the menu
  const alice = await loginAs(browser, 'alice');
  await alice.goto('/admin/modules');
  await expect(alice.getByTestId('module-row')).toHaveCount(0);
});

async function taskIdOf(f: Awaited<ReturnType<typeof fixture>>, taskKey: string) {
  const { data } = await f.admin.bootstrap();
  const [key, num] = taskKey.split('-');
  const p = data.projects!.find((x) => x.key === key)!;
  return data.tasks!.find((t) => t.projectId === p.id && t.number === Number(num))!.id;
}
