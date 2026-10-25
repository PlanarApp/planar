import { expect, test, type Page } from '@playwright/test';
import { Client, uuidv7 } from '../lib.js';
import { fixture, loginAs, uniq } from './helpers.js';
import { setModules } from './collab-helpers.js';
import { enableP4, P4_MODULES, pickIn, pluginServer, spa } from './p4-helpers.js';
import { utcDay } from './work-helpers.js';

let admin: Client;
test.beforeAll(async () => {
  admin = await Client.login('admin');
  await enableP4(admin);
});
test.afterEach(() => enableP4(admin));

const rows = async (entity: string) => (await admin.bootstrap()).data[entity] ?? [];

/** Открыть вкладку модуля в карточке задачи (вкладки появляются после загрузки реплики). */
async function openTab(page: Page, key: string, name: string) {
  await page.goto(`/t/${key}`);
  const tab = page.getByRole('tab', { name, exact: true });
  await expect(tab).toBeVisible();
  await tab.click();
}

const tplTask = (title: string) => ({
  title,
  description: null,
  priority: 0,
  dueInDays: null,
  startInDays: null,
  fields: [],
  labels: [],
  assigneeIds: [],
  checklist: ['Пункт шаблона'],
});

test('pf6: повтор — правило «каждый день» в карточке, nextDate виден, удаление', async ({
  browser,
}) => {
  const f = await fixture([uniq('Повтор')]);
  await f.admin.pushOk([f.admin.mut('task.update', { id: f.taskIds[0], dueDate: utcDay(0) })]);
  const page = await loginAs(browser, 'alice');
  await openTab(page, f.taskKeys[0]!, 'Повтор');
  const panel = page.getByTestId('repeat-panel');
  await panel.locator('select').nth(1).selectOption('day');
  await panel.getByTestId('repeat-save').click();
  await expect(panel.getByTestId('repeat-next')).toContainText(utcDay(1));
  await expect
    .poll(async () => (await rows('recurringRules')).find((r) => r.taskId === f.taskIds[0]))
    .toMatchObject({ kind: 'interval', every: 1, unit: 'day', nextDate: utcDay(1) });

  await panel.getByTestId('repeat-remove').click();
  await expect(panel.getByTestId('repeat-next')).toHaveCount(0);
  await expect
    .poll(async () => (await rows('recurringRules')).some((r) => r.taskId === f.taskIds[0]))
    .toBe(false);
});

test('pf6: шаблоны — задача из шаблона через меню «Новая задача» и Cmd+K: чек-лист и подзадача', async ({
  browser,
}) => {
  const f = await fixture([uniq('Фон')]);
  const title = uniq('Из шаблона');
  await f.admin.pushOk([
    f.admin.mut('templates.create', {
      id: uuidv7(),
      spaceId: f.spaceId,
      kind: 'task',
      name: title,
      data: { ...tplTask(title), subtasks: [tplTask(`${title} под`)] },
    }),
  ]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/p/${f.projectId}`);
  const made = async () => (await rows('tasks')).filter((t) => t.title === title);

  await page.getByRole('button', { name: 'Новая задача из…' }).first().click();
  await page.getByRole('menuitem', { name: 'Задача из шаблона…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: title }).click();
  await expect.poll(async () => (await made()).length).toBe(1);
  // созданная задача открывается окном поверх вида — закрываем, иначе в DOM два диалога
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('task-modal')).toHaveCount(0);

  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').getByRole('textbox').fill('Задача из шаблона');
  await page.getByRole('option', { name: /Задача из шаблона…/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: title }).click();
  await expect.poll(async () => (await made()).length).toBe(2);

  const ids = (await made()).map((t) => t.id);
  const items = await rows('checklistItems');
  const subs = (await rows('tasks')).filter((t) => ids.includes(t.parentId as string));
  expect(subs.map((t) => t.title)).toEqual([`${title} под`, `${title} под`]);
  for (const id of ids)
    expect(items.filter((i) => i.taskId === id).map((i) => i.text)).toEqual(['Пункт шаблона']);
});

test('pf6: шаблоны — «Сохранить как шаблон», проект из шаблона в настройках', async ({
  browser,
}) => {
  const f = await fixture([uniq('Сохранить')]);
  const tplName = uniq('Мой шаблон');
  const page = await loginAs(browser, 'alice');
  await page.goto(`/t/${f.taskKeys[0]}`);
  await expect(page.getByRole('tab', { name: 'Повтор' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').getByRole('textbox').fill('Сохранить как шаблон');
  await page.getByRole('option', { name: /Сохранить как шаблон/ }).click();
  await page.getByLabel('Название шаблона').fill(tplName);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect
    .poll(async () =>
      (await rows('templatesTemplates')).some((t) => t.name === tplName && t.kind === 'task'),
    )
    .toBe(true);

  await spa(page, '/settings/templates:templates', page.getByTestId('templates-settings'));
  await pickIn(page, 'Пространство', `e2e ${f.spaceId}`);
  const row = page.getByTestId('tpl-row').filter({ hasText: tplName });
  await expect(row).toBeVisible();

  // проект → шаблон → новый проект
  const projTpl = uniq('Шаблон проекта');
  await page.getByRole('button', { name: 'Сохранить проект как шаблон' }).click();
  await page.getByLabel('Название шаблона').fill(projTpl);
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
  const prow = page.getByTestId('tpl-row').filter({ hasText: projTpl });
  await expect(prow).toBeVisible();
  await prow.getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Создать проект из шаблона' }).click();
  const newKey = `Q${f.key.slice(0, 4)}`;
  const newName = uniq('Копия');
  await page.getByLabel('Название проекта').fill(newName);
  await page.getByLabel(/Ключ/).fill(newKey);
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect
    .poll(async () => (await rows('projects')).some((p) => p.name === newName && p.key === newKey))
    .toBe(true);
  const np = (await rows('projects')).find((p) => p.key === newKey)!;
  expect((await rows('tasks')).filter((t) => t.projectId === np.id)).toHaveLength(1);
});

test('pf6: цели — цель, ключевой результат «число», правка current меняет прогресс', async ({
  browser,
}) => {
  const f = await fixture([uniq('Цель')]);
  const page = await loginAs(browser, 'alice');
  await spa(page, '/m/goals/', page.getByTestId('goals-page'));
  await pickIn(page, 'Пространство', `e2e ${f.spaceId}`);
  const goal = uniq('Цель');
  await page.getByLabel('Новая цель').fill(goal);
  await page.getByTestId('goal-create').click();
  const card = page.getByTestId('goal').filter({ hasText: goal });
  await card.getByRole('button', { name: 'Ключевой результат' }).click();
  const krName = uniq('Выручка'); // база общая: прежние прогоны оставили свои «Выручка»
  await card.getByLabel('Название', { exact: true }).fill(krName);
  await card.getByLabel('Цель', { exact: true }).fill('200');
  await card.getByRole('button', { name: 'Создать' }).click();
  const kr = card.getByTestId('kr');
  await expect(kr).toContainText(krName);
  await expect(card.getByTestId('goal-percent')).toHaveText('0%');
  await kr.getByLabel('Текущее').fill('50');
  await kr.getByLabel('Текущее').blur();
  await expect(card.getByTestId('goal-percent')).toHaveText('25%');
  await expect
    .poll(async () => {
      const k = (await rows('goalsKeyResults')).find((x) => x.name === krName);
      return (k?.metric as { current: number } | undefined)?.current;
    })
    .toBe(50);
});

test('pf6: вехи — веха, задача в вехе, прогресс; линия вехи на Timeline', async ({ browser }) => {
  const f = await fixture([uniq('В вехе'), uniq('Вне вехи')]);
  const page = await loginAs(browser, 'alice');
  const msName = uniq('Релиз');
  await spa(page, `/p/${f.projectId}/goals:milestones`, page.getByTestId('milestones'));
  await page.getByLabel('Название', { exact: true }).fill(msName);
  await page.getByLabel('Дата').fill(utcDay(3));
  await page.getByTestId('ms-create').click();
  const row = page.getByTestId('ms-row').filter({ hasText: msName });
  await expect(row).toBeVisible();
  await expect
    .poll(async () => (await rows('goalsMilestones')).some((m) => m.name === msName))
    .toBe(true);
  const ms = (await rows('goalsMilestones')).find((m) => m.name === msName)!;

  // задача в вехе, затем закрыта (done) — 100%
  const done = (await f.admin.bootstrap()).data.statuses!.find(
    (s) => f.statusIds.includes(s.id as string) && s.category === 'done',
  )!;
  await f.admin.pushOk([
    f.admin.mut('goals.milestone.setTask', {
      id: uuidv7(),
      taskId: f.taskIds[0],
      milestoneId: ms.id,
    }),
  ]);
  await expect(row).toContainText(f.taskKeys[0]!);
  await expect(row.getByTestId('ms-percent')).toHaveText('0%');
  await f.admin.pushOk([f.admin.mut('task.update', { id: f.taskIds[0], statusId: done.id })]);
  await expect(row.getByTestId('ms-percent')).toHaveText('100%');

  await spa(
    page,
    `/p/${f.projectId}/timeline:timeline`,
    page.getByTestId('tl-milestone').filter({ hasText: msName }),
  );
});

test('pf6: email — без SMTP переключатель неактивен с причиной; настройка → включение; настройки пользователя; отписка 400', async ({
  browser,
}) => {
  const page = await loginAs(browser, 'admin');
  await spa(page, '/settings/modules', page.getByTestId('module-row').first());
  const row = page.getByTestId('module-row').filter({ hasText: 'email' });
  // SMTP нельзя «разнастроить» через API: на стеке с уже заданным SMTP проверка неактивности пропускается
  const cfg = await (await admin.ctx.get('/api/email/setup/config')).json();
  if (!cfg.configured) {
    await expect(row.getByRole('switch')).toBeDisabled();
    await expect(row.getByTestId('module-unavailable')).toContainText('SMTP');
  }

  // форма перезаписывается ответом GET config при монтировании — заполняем после него
  const loaded = page.waitForResponse(
    (r) => r.url().endsWith('/api/email/setup/config') && r.request().method() === 'GET',
  );
  await row.getByTestId('module-setup').click();
  await loaded;
  const setup = page.getByTestId('email-setup');
  await setup.getByTestId('email-host').fill('127.0.0.1');
  await setup.getByTestId('email-port').fill('2525');
  await setup.getByTestId('email-from').fill('Planar <planar@example.com>');
  const put = page.waitForResponse(
    (r) => r.url().endsWith('/api/email/setup/config') && r.request().method() === 'PUT',
  );
  await setup.getByTestId('email-save').click();
  expect((await put).status()).toBe(200);
  await page.keyboard.press('Escape');
  await expect(row.getByRole('switch')).toBeEnabled();
  await row.getByRole('switch').check();
  await expect
    .poll(async () => {
      const v = (await rows('settings')).find((s) => s.id === 'enabled_modules')?.value;
      return Array.isArray(v) && v.includes('email');
    })
    .toBe(true);

  // пользователь: переключатели notify/digest сохраняются
  const al = await Client.login('alice');
  await al.pushOk([al.mut('email.setPrefs', { id: al.userId, notify: true, digest: false })]);
  const alice = await loginAs(browser, 'alice');
  await spa(alice, '/settings/email:prefs', alice.getByTestId('email-prefs'));
  const prefs = async () =>
    ((await al.bootstrap()).data.emailPrefs ?? []).find((p) => p.userId === al.userId);
  await alice.getByTestId('email-notify').uncheck();
  await alice.getByTestId('email-digest').check();
  await expect
    .poll(async () => [(await prefs())?.notify, (await prefs())?.digest])
    .toEqual([false, true]);
  await alice.reload();
  await expect(alice.getByTestId('email-notify')).not.toBeChecked();
  await expect(alice.getByTestId('email-digest')).toBeChecked();

  const bad = await admin.ctx.get('/api/email/unsubscribe?t=bad');
  expect(bad.status()).toBe(400);
  expect(bad.headers()['content-type']).toContain('text/html');
  await setModules(admin, P4_MODULES);
});

test('pf6: плагины — регистрация, iframe показывает задачу, «Комментарий» создаёт комментарий', async ({
  browser,
}) => {
  const srv = await pluginServer();
  try {
    const title = uniq('Для плагина');
    const f = await fixture([title]);
    const name = uniq('Hello');
    const page = await loginAs(browser, 'admin');
    await spa(page, '/settings/plugins:admin', page.getByTestId('plugins-admin'));
    const form = page.getByTestId('plugins-admin');
    await form.getByPlaceholder('Название').fill(name);
    await form.getByPlaceholder('Адрес (URL)').fill(srv.url);
    for (const e of ['tasks', 'users', 'comments'])
      await form.getByLabel(e, { exact: true }).first().check();
    await form.getByRole('group', { name: 'Запись' }).getByLabel('comments').check();
    await form.getByPlaceholder(/Панель задачи/).fill('Hello');
    await form.getByRole('button', { name: 'Добавить' }).click();
    await expect(form.getByText(name)).toBeVisible();

    await page.goto(`/t/${f.taskKeys[0]}`);
    const tab = page.getByRole('tab', { name: 'Плагины', exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    const frame = page.frameLocator(`iframe[src^="${srv.url}"]`);
    await expect(frame.locator('#task')).toContainText(title);
    await frame.getByRole('button', { name: 'Комментарий' }).click();
    await expect(frame.locator('#msg')).toHaveText('Готово');
    await expect
      .poll(async () => (await rows('comments')).some((c) => c.taskId === f.taskIds[0]))
      .toBe(true);
  } finally {
    await srv.close();
  }
});

test('pf6: плагины — регистрация URL с хостом приложения отклоняется', async ({ browser }) => {
  const page = await loginAs(browser, 'admin');
  await spa(page, '/settings/plugins:admin', page.getByTestId('plugins-admin'));
  const form = page.getByTestId('plugins-admin');
  await form.getByPlaceholder('Название').fill(uniq('Bad'));
  await form.getByPlaceholder('Адрес (URL)').fill('http://localhost:9999/');
  await form.getByLabel('tasks', { exact: true }).first().check();
  await form.getByPlaceholder(/Панель задачи/).fill('x');
  await form.getByRole('button', { name: 'Добавить' }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  expect(
    ((await admin.bootstrap()).data.pluginsPlugins ?? []).some((p) =>
      p.name.toString().startsWith('Bad'),
    ),
  ).toBe(false);
});
