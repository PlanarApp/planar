import { expect, test, type Page } from '@playwright/test';
import { uuidv7 } from '../lib.js';
import { fixture, loginAs, uniq } from './helpers.js';
import { addField, dayOfMonth, serverLinks, serverTask } from './features-helpers.js';

const cell = (p: Page, day: string) => p.locator(`[data-day="${day}"]`);

// ---------- Календарь

test('календарь: диапазон start..due на каждом дне, без дат — в «Без даты»', async ({
  browser,
}) => {
  const [a, b] = [uniq('Диапазон'), uniq('Без даты')];
  const f = await fixture([a, b]);
  await f.admin.pushOk([
    f.admin.mut('task.update', {
      id: f.taskIds[0],
      startDate: dayOfMonth(14),
      dueDate: dayOfMonth(16),
    }),
  ]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/p/${f.projectId}/calendar`);
  for (const d of [14, 15, 16])
    await expect(cell(page, dayOfMonth(d)).locator(`[data-task="${f.taskIds[0]}"]`)).toBeVisible();
  await expect(cell(page, dayOfMonth(17)).locator(`[data-task="${f.taskIds[0]}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-test=undated] [data-task="${f.taskIds[1]}"]`)).toBeVisible();
});

test('календарь: перенос сохраняет длительность; из «Без даты» ставит срок; видно bob', async ({
  browser,
}) => {
  const [a, b] = [uniq('Перенос'), uniq('Из боковой')];
  const f = await fixture([a, b]);
  await f.admin.pushOk([
    f.admin.mut('task.update', {
      id: f.taskIds[0],
      startDate: dayOfMonth(14),
      dueDate: dayOfMonth(15),
    }),
  ]);
  const page = await loginAs(browser, 'alice');
  const bob = await loginAs(browser, 'bob');
  await bob.goto(`/p/${f.projectId}/calendar`);
  await page.goto(`/p/${f.projectId}/calendar`);
  await cell(page, dayOfMonth(14))
    .locator(`[data-task="${f.taskIds[0]}"]`)
    .dragTo(cell(page, dayOfMonth(20)));
  await expect(cell(page, dayOfMonth(20)).locator(`[data-task="${f.taskIds[0]}"]`)).toBeVisible();
  await expect(cell(page, dayOfMonth(21)).locator(`[data-task="${f.taskIds[0]}"]`)).toBeVisible();
  await expect
    .poll(async () => {
      const t = await serverTask(f, f.taskIds[0]!);
      return [t.startDate, t.dueDate];
    })
    .toEqual([dayOfMonth(20), dayOfMonth(21)]);
  await expect(cell(bob, dayOfMonth(21)).locator(`[data-task="${f.taskIds[0]}"]`)).toBeVisible({
    timeout: 10_000,
  });

  await page
    .locator(`[data-test=undated] [data-task="${f.taskIds[1]}"]`)
    .dragTo(cell(page, dayOfMonth(10)));
  await expect(cell(page, dayOfMonth(10)).locator(`[data-task="${f.taskIds[1]}"]`)).toBeVisible();
  await expect.poll(async () => (await serverTask(f, f.taskIds[1]!)).dueDate).toBe(dayOfMonth(10));
});

test('календарь: неделя/месяц, навигация и запоминание режима после reload', async ({
  browser,
}) => {
  const f = await fixture([uniq('Режим')]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/p/${f.projectId}/calendar`);
  const title = page.locator('[data-test=title]');
  const t0 = await title.textContent();
  await page.getByRole('button', { name: 'Вперёд' }).click();
  await expect(title).not.toHaveText(t0!);
  await page.getByRole('button', { name: 'Сегодня' }).click();
  await expect(title).toHaveText(t0!);

  const days = page.locator('[data-day]');
  const month = await days.count();
  expect(month % 7).toBe(0);
  await page.locator('[data-test=mode-week]').click();
  await expect(days).toHaveCount(7);
  // неделя начинается с понедельника
  const first = await days.first().getAttribute('data-day');
  const [y, m, d] = first!.split('-').map(Number);
  expect(new Date(y!, m! - 1, d).getDay()).toBe(1);
  await page.reload();
  await expect(page.locator('[data-test=mode-week]')).toHaveAttribute('aria-pressed', 'true');
  await expect(days).toHaveCount(7);
});

test('календарь: на телефоне — список по дням', async ({ browser }) => {
  const t = uniq('Мобильная');
  const f = await fixture([t]);
  await f.admin.pushOk([f.admin.mut('task.update', { id: f.taskIds[0], dueDate: dayOfMonth(15) })]);
  const page = await loginAs(browser, 'alice');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/p/${f.projectId}/calendar`);
  await expect(page.locator('[data-test=agenda]')).toContainText(t);
  await expect(page.locator('[data-day]')).toHaveCount(0);
});

// ---------- Таблица

test('таблица: строки, правка названия двойным щелчком, видно bob', async ({ browser }) => {
  const t = uniq('Таблица');
  const f = await fixture([t]);
  const page = await loginAs(browser, 'alice');
  const bob = await loginAs(browser, 'bob');
  await bob.goto(`/p/${f.projectId}/table`);
  await page.goto(`/p/${f.projectId}/table`);
  const row = page.locator(`[role=row][data-task="${f.taskKeys[0]}"]`);
  await expect(row).toContainText(t);
  await row.getByText(t).dblclick();
  const name = uniq('Новое имя');
  await page.getByLabel('Название задачи', { exact: true }).fill(name);
  await page.keyboard.press('Enter');
  await expect(row).toContainText(name);
  await expect(bob.locator(`[role=row][data-task="${f.taskKeys[0]}"]`)).toContainText(name, {
    timeout: 10_000,
  });
  expect((await serverTask(f, f.taskIds[0]!)).title).toBe(name);
});

test('таблица: колонки — скрыть, показать, ширина; раскладка переживает reload', async ({
  browser,
}) => {
  const f = await fixture([uniq('Колонки')]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/p/${f.projectId}/table`);
  const col = (id: string) => page.locator(`[role=columnheader][data-col="${id}"]`);
  await expect(col('key')).toBeVisible();
  await page.getByRole('button', { name: 'Меню колонки «Ключ»' }).click();
  await page.getByRole('button', { name: 'Скрыть' }).click();
  await expect(col('key')).toHaveCount(0);

  await page.getByRole('button', { name: 'Колонки', exact: true }).click();
  await page.getByLabel('Начало', { exact: true }).check();
  await expect(col('startDate')).toBeVisible();
  await page.keyboard.press('Escape');

  const box = (await col('title').boundingBox())!;
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 99, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const w = (await col('title').boundingBox())!.width;
  expect(w).toBeGreaterThan(box.width + 50);

  await page.reload();
  await expect(col('startDate')).toBeVisible();
  await expect(col('key')).toHaveCount(0);
  expect(Math.abs((await col('title').boundingBox())!.width - w)).toBeLessThan(2);
});

test('таблица: выбор строк показывает панель массовых действий', async ({ browser }) => {
  const f = await fixture([uniq('Выбор-1'), uniq('Выбор-2')]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/p/${f.projectId}/table`);
  const checks = page.getByRole('checkbox', { name: 'Выбрать задачу' });
  await expect(checks).toHaveCount(2);
  await checks.nth(0).click();
  await checks.nth(1).click({ modifiers: ['Shift'] });
  await expect(page.getByRole('toolbar', { name: /^Выбрано/ })).toContainText('Выбрано: 2');
  await page.getByRole('button', { name: 'Снять выбор' }).click();
  await expect(page.getByRole('toolbar', { name: /^Выбрано/ })).toHaveCount(0);
});

// ---------- Пользовательские поля

test('поля: создать поле в диалоге, задать значение; переживает reload и видно bob', async ({
  browser,
}) => {
  const f = await fixture([uniq('Поля')]);
  const page = await loginAs(browser, 'alice');
  const bob = await loginAs(browser, 'bob');
  await page.goto(`/t/${f.taskKeys[0]}`);
  await page.getByTestId('fields-configure').click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Название', { exact: true }).fill('Заметка');
  await dlg.getByRole('button', { name: 'Добавить поле' }).click();
  await expect(dlg.getByTestId('field-def')).toHaveCount(1);
  await page.keyboard.press('Escape');

  const input = page.getByTestId('fields-block').getByLabel('Заметка');
  await input.fill('значение 1');
  await input.press('Enter');
  await expect
    .poll(async () => Object.values((await serverTask(f, f.taskIds[0]!)).fields as object))
    .toEqual(['значение 1']);
  await page.reload();
  await expect(page.getByTestId('fields-block').getByLabel('Заметка')).toHaveValue('значение 1');
  await bob.goto(`/t/${f.taskKeys[0]}`);
  await expect(bob.getByTestId('fields-block').getByLabel('Заметка')).toHaveValue('значение 1', {
    timeout: 10_000,
  });
});

test('поля: число, деньги (запятая → копейки), ссылка; неверное не сохраняется; очистка', async ({
  browser,
}) => {
  const f = await fixture([uniq('Типы')]);
  const num = await addField(f, 'Число', 'number');
  const money = await addField(f, 'Сумма', 'money');
  const url = await addField(f, 'Адрес', 'url');
  const page = await loginAs(browser, 'alice');
  await page.goto(`/t/${f.taskKeys[0]}`);
  const block = page.getByTestId('fields-block');
  const fields = async () => (await serverTask(f, f.taskIds[0]!)).fields as Record<string, unknown>;

  await block.getByLabel('Число').fill('42.5');
  await block.getByLabel('Число').press('Enter');
  await block.getByLabel('Сумма').fill('12,5');
  await block.getByLabel('Сумма').press('Enter');
  await block.getByLabel('Адрес').fill('https://example.com/x');
  await block.getByLabel('Адрес').press('Enter');
  await expect.poll(fields).toEqual({ [num]: 42.5, [money]: 1250, [url]: 'https://example.com/x' });

  await block.getByLabel('Число').fill('abc');
  await block.getByLabel('Число').press('Enter');
  await expect(block.getByText('Неверное значение')).toHaveCount(1);
  await block.getByLabel('Адрес').fill('ftp://bad');
  await block.getByLabel('Адрес').press('Enter');
  await expect(block.getByText('Неверное значение')).toHaveCount(2);
  expect(await fields()).toEqual({ [num]: 42.5, [money]: 1250, [url]: 'https://example.com/x' });

  await block.getByLabel('Число').fill('');
  await block.getByLabel('Число').press('Enter');
  await expect.poll(fields).toEqual({ [money]: 1250, [url]: 'https://example.com/x' });
});

test('поля: выбор из вариантов, пользователь, очистка', async ({ browser }) => {
  const f = await fixture([uniq('Выбор')]);
  const sel = await addField(f, 'Размер', 'select', {
    choices: [
      { id: 'ch-s', label: 'Малый' },
      { id: 'ch-l', label: 'Большой' },
    ],
  });
  const usr = await addField(f, 'Ревьюер', 'user');
  const page = await loginAs(browser, 'alice');
  await page.goto(`/t/${f.taskKeys[0]}`);
  const block = page.getByTestId('fields-block');
  const fields = async () => (await serverTask(f, f.taskIds[0]!)).fields as Record<string, unknown>;

  await block.getByRole('combobox', { name: 'Размер' }).click();
  await page.getByRole('option', { name: 'Большой' }).click();
  await block.getByRole('combobox', { name: 'Ревьюер' }).click();
  await page.getByRole('option', { name: 'Bob' }).click();
  await expect.poll(async () => (await fields())[sel]).toBe('ch-l');
  await expect.poll(async () => typeof (await fields())[usr]).toBe('string');

  await block.getByRole('button', { name: 'Очистить' }).first().click();
  await expect.poll(async () => Object.keys(await fields()).length).toBe(1);
});

test('поля: удаление поля чистит значения задач', async ({ browser }) => {
  const f = await fixture([uniq('Удаление поля')]);
  const id = await addField(f, 'Временное', 'text');
  await f.admin.pushOk([
    f.admin.mut('task.setField', { taskId: f.taskIds[0], fieldId: id, value: 'x' }),
  ]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/t/${f.taskKeys[0]}`);
  await expect(page.getByTestId('fields-block').getByLabel('Временное')).toHaveValue('x');
  await page.getByTestId('fields-configure').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить' }).first().click();
  await page.getByTestId('confirm-field-delete').click();
  await expect(page.getByTestId('field-def')).toHaveCount(0);
  await expect.poll(async () => (await serverTask(f, f.taskIds[0]!)).fields).toEqual({});
});

// ---------- Связи

test('связи: создать «блокирует» в панели; у второй задачи — «Заблокирована»; удалить', async ({
  browser,
}) => {
  const [a, b] = [uniq('Блокер'), uniq('Заблокированная')];
  const f = await fixture([a, b]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/t/${f.taskKeys[0]}`);
  const links = page.getByRole('region', { name: 'Связи' });
  await links.getByLabel('Найти задачу по названию или ключу').fill(b);
  await links.getByTestId('candidate').filter({ hasText: b }).click();
  await expect(links.getByRole('heading', { name: 'Блокирует' })).toBeVisible();
  await expect(links).toContainText(b);

  await page.goto(`/t/${f.taskKeys[1]}`);
  const other = page.getByRole('region', { name: 'Связи' });
  await expect(other.getByRole('heading', { name: 'Заблокирована' })).toBeVisible();
  await expect(other).toContainText(a);
  await other.getByTestId('unlink').click();
  await expect(other.getByTestId('unlink')).toHaveCount(0);
  await page.goto(`/t/${f.taskKeys[0]}`);
  await expect(page.getByRole('region', { name: 'Связи' }).getByTestId('unlink')).toHaveCount(0);
});

test('связи: повторная связь той же пары — сообщение, дубликат не создаётся', async ({
  browser,
}) => {
  const [a, b] = [uniq('Связь-A'), uniq('Связь-B')];
  const f = await fixture([a, b]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/t/${f.taskKeys[0]}`);
  const links = page.getByRole('region', { name: 'Связи' });
  await links.getByLabel('Найти задачу по названию или ключу').fill(b);
  await links.getByTestId('candidate').filter({ hasText: b }).click();
  await expect(links.getByTestId('unlink')).toHaveCount(1);
  await expect.poll(() => serverLinks(f)).toBe(1);
  // уже связанная задача из поиска исчезает
  await links.getByLabel('Найти задачу по названию или ключу').fill(b);
  await expect(links.getByTestId('candidate')).toHaveCount(0);
  // обратная сторона той же пары, созданная параллельно извне, отвергается как conflict
  const r = await f.admin.push([
    f.admin.mut('link.create', {
      id: uuidv7(),
      taskId: f.taskIds[1],
      targetId: f.taskIds[0],
      kind: 'relates',
    }),
  ]);
  expect(r[0]!.ok).toBe(false);
  expect(r[0]!.code).toBe('conflict');
});

test('связи: заблокированная задача помечена на доске, после удаления связи — нет', async ({
  browser,
}) => {
  const [a, b] = [uniq('Блокирует'), uniq('Ждёт')];
  const f = await fixture([a, b]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/t/${f.taskKeys[0]}`);
  const links = page.getByRole('region', { name: 'Связи' });
  await links.getByLabel('Найти задачу по названию или ключу').fill(b);
  await links.getByTestId('candidate').filter({ hasText: b }).click();
  await expect(links.getByTestId('unlink')).toHaveCount(1);
  await expect.poll(() => serverLinks(f)).toBe(1);

  await page.goto(`/p/${f.projectId}/board`);
  const card = (i: number) => page.locator(`[data-id="${f.taskIds[i]}"]`);
  await expect(card(1)).toBeVisible();
  await expect(card(1).getByRole('img', { name: 'Заблокирована' })).toBeVisible();
  await expect(card(0).getByRole('img', { name: 'Заблокирована' })).toHaveCount(0);

  await page.goto(`/t/${f.taskKeys[0]}`);
  await page.getByRole('region', { name: 'Связи' }).getByTestId('unlink').click();
  await expect.poll(() => serverLinks(f)).toBe(0);
  await page.goto(`/p/${f.projectId}/board`);
  await expect(card(1)).toBeVisible();
  await expect(card(1).getByRole('img', { name: 'Заблокирована' })).toHaveCount(0);
});

test('связи: заблокированная задача помечена в списке', async ({ browser }) => {
  const [a, b] = [uniq('Блокирует'), uniq('Ждёт')];
  const f = await fixture([a, b]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/t/${f.taskKeys[0]}`);
  const links = page.getByRole('region', { name: 'Связи' });
  await links.getByLabel('Найти задачу по названию или ключу').fill(b);
  await links.getByTestId('candidate').filter({ hasText: b }).click();
  await expect.poll(() => serverLinks(f)).toBe(1);
  await page.goto(`/p/${f.projectId}/list`);
  const row = (k: string) => page.locator(`[data-task="${k}"]`);
  await expect(row(f.taskKeys[1]!).getByRole('img', { name: 'Заблокирована' })).toBeVisible();
  await expect(row(f.taskKeys[0]!).getByRole('img', { name: 'Заблокирована' })).toHaveCount(0);
});

test('связи: «связана» видна с обеих сторон под одним заголовком', async ({ browser }) => {
  const [a, b] = [uniq('Рел-A'), uniq('Рел-B')];
  const f = await fixture([a, b]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/t/${f.taskKeys[0]}`);
  const links = page.getByRole('region', { name: 'Связи' });
  await links.getByRole('combobox', { name: 'Добавить связь' }).click();
  await page.getByRole('option', { name: 'Связана' }).click();
  await links.getByLabel('Найти задачу по названию или ключу').fill(b);
  await links.getByTestId('candidate').filter({ hasText: b }).click();
  await expect(links.getByRole('heading', { name: 'Связана' })).toBeVisible();
  await page.goto(`/t/${f.taskKeys[1]}`);
  const other = page.getByRole('region', { name: 'Связи' });
  await expect(other.getByRole('heading', { name: 'Связана' })).toBeVisible();
  await expect(other).toContainText(a);
});

// ---------- Колонки полей в Таблице, снятие блокировки

test('таблица: колонка числового поля — показ и правка ячейки; переживает reload', async ({
  browser,
}) => {
  const f = await fixture([uniq('Колонка поля')]);
  const fid = await addField(f, 'Оценка', 'number');
  const page = await loginAs(browser, 'alice');
  await page.goto(`/p/${f.projectId}/table`);
  await page.getByRole('button', { name: 'Колонки', exact: true }).click();
  await page.getByLabel('Оценка', { exact: true }).check();
  await page.keyboard.press('Escape');
  const cellOf = () =>
    page.locator(`[data-task="${f.taskKeys[0]}"] [role=gridcell][data-col="field:${fid}"]`);
  await cellOf().dblclick();
  const input = cellOf().locator('input');
  await input.fill('7');
  await input.press('Enter');
  await expect.poll(async () => (await serverTask(f, f.taskIds[0]!)).fields).toEqual({ [fid]: 7 });

  await page.reload();
  await expect(cellOf()).toContainText('7');
  await page.goto(`/t/${f.taskKeys[0]}`);
  await expect(page.getByTestId('fields-block').getByLabel('Оценка')).toHaveValue('7');
});

test('связи: пометка «заблокирована» снимается, когда блокирующая задача завершена', async ({
  browser,
}) => {
  const f = await fixture([uniq('Блокер'), uniq('Блокируемая')]);
  await f.admin.pushOk([
    f.admin.mut('link.create', {
      id: uuidv7(),
      taskId: f.taskIds[0],
      targetId: f.taskIds[1],
      kind: 'blocks',
    }),
  ]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/p/${f.projectId}/board`);
  const mark = page
    .locator(`[data-id="${f.taskIds[1]}"]`)
    .getByRole('img', { name: 'Заблокирована' });
  await expect(mark).toBeVisible();

  // statusIds[3] — категория done
  await f.admin.pushOk([
    f.admin.mut('task.update', { id: f.taskIds[0], statusId: f.statusIds[3] }),
  ]);
  await expect(mark).toHaveCount(0, { timeout: 10_000 });
  await page.reload();
  await expect(page.locator(`[data-id="${f.taskIds[1]}"]`)).toBeVisible();
  await expect(mark).toHaveCount(0);
});
