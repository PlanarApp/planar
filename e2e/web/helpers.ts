import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import { Client, ranks, uuidv7 } from '../lib.js';

export interface Fixture {
  admin: Client;
  spaceId: string;
  projectId: string;
  /** project key; project name — `E2E ${key}` */
  key: string;
  statusIds: string[];
  /** task key of the form ABCDE-1 */
  taskKeys: string[];
  taskIds: string[];
}

const letters = () =>
  Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join(
    '',
  );

/** Selection in Reka Select (there is no native <select>): option by focus and Enter — a long list does not fit the window for a click. */
export async function pick(trigger: Locator, name: string): Promise<void> {
  await trigger.click();
  const opt = trigger.page().getByRole('option', { name, exact: true });
  await opt.focus();
  await opt.press('Enter');
}

/** Data modules (C-schema v16): on or off per project, the rest are shared (settings.enabled_modules). */
export const DATA_MODULES = [
  'gitlab',
  'sprints',
  'time',
  'forms',
  'recurring',
  'automations',
  'templates',
  'goals',
  'timeline',
  'workload',
  'dashboards',
  'docs',
];

/** Mutations that turn the data modules on in a project (the test project works like the whole instance before PJ-3). */
export const enableInProject = (admin: Client, projectId: string, ids = DATA_MODULES) =>
  ids.map((moduleId) => admin.mut('project.setModule', { projectId, moduleId, enabled: true }));

/** Own space with alice and bob (members), a project and tasks with unique names. */
export async function fixture(titles: string[]): Promise<Fixture> {
  const admin = await Client.login('admin');
  const key = letters();
  const [alice, bob] = await Promise.all([Client.login('alice'), Client.login('bob')]);
  const spaceId = uuidv7();
  const projectId = uuidv7();
  const statusIds = Array.from({ length: 5 }, () => uuidv7());
  const taskIds = titles.map(() => uuidv7());
  const [r1, r2, ...tr] = ranks(2 + titles.length);
  await admin.pushOk([
    admin.mut('space.create', {
      id: spaceId,
      name: `e2e ${spaceId}`,
      rank: r1,
      memberId: uuidv7(),
    }),
    admin.mut('member.add', { id: uuidv7(), spaceId, userId: alice.userId, role: 'member' }),
    admin.mut('member.add', { id: uuidv7(), spaceId, userId: bob.userId, role: 'member' }),
    admin.mut('project.create', {
      id: projectId,
      spaceId,
      name: `E2E ${key}`,
      key,
      rank: r2,
      statusIds,
    }),
    ...enableInProject(admin, projectId),
    ...titles.map((title, i) =>
      admin.mut('task.create', {
        id: taskIds[i],
        projectId,
        statusId: statusIds[0],
        title,
        rank: tr[i],
      }),
    ),
  ]);
  const { data } = await admin.bootstrap();
  const num = (id: string) => data.tasks!.find((t) => t.id === id)!.number;
  return {
    admin,
    spaceId,
    projectId,
    key,
    statusIds,
    taskIds,
    taskKeys: taskIds.map((id) => `${key}-${num(id)}`),
  };
}

export const uniq = (p: string) => `${p} ${uuidv7().slice(-12)}`;

/** New browser context with login via the form. */
export async function loginAs(browser: Browser, login: string): Promise<Page> {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    locale: 'ru-RU',
  });
  const page = await ctx.newPage();
  let netChanged = false;
  page.on('requestfailed', (r) => {
    if (r.failure()?.errorText.includes('ERR_NETWORK_CHANGED')) netChanged = true;
  });
  await page.goto('/login');
  // dev server: a change of the host network breaks loading of vite modules — the app does not mount; one reload fixes it
  const field = page.getByLabel('Логин');
  const shown = await field.waitFor({ timeout: 10_000 }).then(
    () => true,
    () => false,
  );
  if (!shown && netChanged) await page.reload();
  await field.fill(login);
  await page.getByLabel('Пароль').fill(login);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  return page;
}
