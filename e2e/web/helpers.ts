import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import { Client, ranks, uuidv7 } from '../lib.js';

export interface Fixture {
  admin: Client;
  spaceId: string;
  projectId: string;
  /** ключ проекта; название проекта — `E2E ${key}` */
  key: string;
  statusIds: string[];
  /** ключ задачи вида ABCDE-1 */
  taskKeys: string[];
  taskIds: string[];
}

const letters = () =>
  Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join(
    '',
  );

/** Выбор в Reka Select (нативного <select> нет): опция фокусом и Enter — длинный список не влезает в окно для клика. */
export async function pick(trigger: Locator, name: string): Promise<void> {
  await trigger.click();
  const opt = trigger.page().getByRole('option', { name, exact: true });
  await opt.focus();
  await opt.press('Enter');
}

/** Своё пространство с alice и bob (участники), проектом и задачами с уникальными названиями. */
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
      statusIds,
    }),
    admin.mut('member.add', { id: uuidv7(), spaceId, userId: alice.userId, role: 'member' }),
    admin.mut('member.add', { id: uuidv7(), spaceId, userId: bob.userId, role: 'member' }),
    admin.mut('project.create', { id: projectId, spaceId, name: `E2E ${key}`, key, rank: r2 }),
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

/** Новый браузерный контекст со входом через форму. */
export async function loginAs(browser: Browser, login: string): Promise<Page> {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    locale: 'ru-RU',
  });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль').fill(login);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  return page;
}
