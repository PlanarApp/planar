import { expect, test } from '@playwright/test';
import { fixture, loginAs, uniq } from './helpers.js';

test('вход: admin/admin попадает на главную с боковой панелью; неверный пароль — сообщение', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Логин').fill('admin');
  await page.getByLabel('Пароль').fill('wrong-pass');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId('sidebar')).toHaveCount(0);
  await expect(page.getByText(/парол|неверн/i).first()).toBeVisible();

  await page.getByLabel('Пароль').fill('admin');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByText('Пространства')).toBeVisible();
});

test('создать задачу в списке: видна и переживает reload', async ({ browser }) => {
  const f = await fixture([]);
  const page = await loginAs(browser, 'alice');
  const title = uniq('Новая из UI');
  await page.goto(`/p/${f.projectId}`);
  await page.getByRole('button', { name: 'Создать задачу' }).click();
  await page.getByPlaceholder('Новая задача').fill(title);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('row').filter({ hasText: title })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: title })).toBeVisible();
  // на сервере: другой пользователь видит
  const bob = await loginAs(browser, 'bob');
  await bob.goto(`/p/${f.projectId}`);
  await expect(bob.getByRole('row').filter({ hasText: title })).toBeVisible();
});

test('доска: перетаскивание в другую колонку видно второму пользователю', async ({ browser }) => {
  const title = uniq('Карточка');
  const f = await fixture([title]);
  const alice = await loginAs(browser, 'alice');
  const bob = await loginAs(browser, 'bob');
  await bob.goto(`/p/${f.projectId}/board`);
  await alice.goto(`/p/${f.projectId}/board`);
  const card = alice.locator(`[data-col="${f.statusIds[0]}"] [data-id="${f.taskIds[0]}"]`);
  await expect(card).toBeVisible();
  const target = alice.locator(`[data-col="${f.statusIds[1]}"]`);
  await expect(target).toBeVisible();
  await card.dragTo(target);
  await expect(
    alice.locator(`[data-col="${f.statusIds[1]}"] [data-id="${f.taskIds[0]}"]`),
  ).toBeVisible();
  await expect(
    bob.locator(`[data-col="${f.statusIds[1]}"] [data-id="${f.taskIds[0]}"]`),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    bob.locator(`[data-col="${f.statusIds[0]}"] [data-id="${f.taskIds[0]}"]`),
  ).toHaveCount(0);
});

test('комментарий с @упоминанием доходит до bob во Входящие', async ({ browser }) => {
  const title = uniq('Для комментария');
  const f = await fixture([title]);
  const alice = await loginAs(browser, 'alice');
  const bob = await loginAs(browser, 'bob');
  await alice.goto(`/t/${f.taskKeys[0]}`);
  const editor = alice.getByRole('textbox', { name: /Написать комментарий/ });
  await editor.click();
  await editor.pressSequentially('привет @Bo');
  await alice.getByRole('option', { name: 'Bob' }).click();
  await editor.pressSequentially(' глянь');
  await alice.getByTestId('comment-send').click();
  await expect(alice.getByTestId('comment')).toContainText('глянь');

  await bob.goto('/inbox');
  const item = bob
    .getByTestId('inbox-item')
    .filter({ hasText: f.taskKeys[0] })
    .filter({ hasText: 'упомянул' });
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.getByRole('button').first().click();
  await expect(bob).toHaveURL(new RegExp(`${f.taskKeys[0]}`));
  await expect(bob.getByLabel('Название')).toHaveValue(title);
});

test('офлайн: правки названия не теряются и доходят после восстановления сети', async ({
  browser,
}) => {
  const titles = [uniq('Офлайн-1'), uniq('Офлайн-2'), uniq('Офлайн-3')];
  const f = await fixture(titles);
  const alice = await loginAs(browser, 'alice');
  const bob = await loginAs(browser, 'bob');
  await bob.goto(`/p/${f.projectId}`);
  await alice.goto(`/p/${f.projectId}`);
  const rows = f.taskKeys.map((k) => alice.locator(`[role=row][data-task="${k}"]`));
  for (const r of rows) await expect(r).toBeVisible();
  await rows[0]!.click(); // прогрев ленивой панели задачи: офлайн её не загрузить
  await expect(alice).toHaveURL(/task=/);
  await alice.context().setOffline(true);
  const names = f.taskKeys.map(() => uniq('Правка офлайн'));
  for (let i = 0; i < rows.length; i++) {
    await rows[i]!.click();
    await alice.keyboard.press('F2'); // dblclick открывает панель и сбивает фокус инлайн-ввода
    await alice.getByLabel('Название задачи', { exact: true }).fill(names[i]!);
    await alice.keyboard.press('Enter');
    await expect(rows[i]).toContainText(names[i]!); // локально правка применена сразу
  }
  await alice.context().setOffline(false);
  for (const n of names)
    await expect(bob.getByRole('row').filter({ hasText: n })).toBeVisible({ timeout: 10_000 });
});
