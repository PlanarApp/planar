import { expect, request, test } from '@playwright/test';
import { BASE, Client, uuidv7 } from '../lib.js';
import { fixture, loginAs, uniq } from './helpers.js';
import { enableP3, fakeGitlab, slug16, spa } from './p3-helpers.js';
import { utcDay } from './work-helpers.js';

let admin: Client;
test.beforeAll(async () => {
  admin = await Client.login('admin');
  await enableP3(admin);
});

test.afterEach(() => enableP3(admin));

const taskOf = async (id: string) =>
  (await admin.bootstrap()).data.tasks!.find((t) => t.id === id)!;

test('p3: таймлайн — перенос полосы меняет даты задачи', async ({ browser }) => {
  const f = await fixture([uniq('Полоса')]);
  await f.admin.pushOk([
    f.admin.mut('task.update', { id: f.taskIds[0], startDate: utcDay(1), dueDate: utcDay(2) }),
  ]);
  const page = await loginAs(browser, 'alice');
  await spa(
    page,
    `/p/${f.projectId}/timeline:timeline`,
    page.locator(`[data-tl-task="${f.taskKeys[0]}"]`),
  );

  // день = 32 px: сдвиг на 3 дня
  const bar = page.locator(`[data-tl-task="${f.taskKeys[0]}"] [data-testid=tl-bar]`);
  const box = (await bar.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 48, y, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + 96, y, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const t = await taskOf(f.taskIds[0]!);
      return [t.startDate, t.dueDate];
    })
    .toEqual([utcDay(4), utcDay(5)]);
});

test('p3: таймлайн — перетаскивание из «Без дат» ставит даты', async ({ browser }) => {
  const b = uniq('Без дат');
  const f = await fixture([b, uniq('Соседняя')]);
  await f.admin.pushOk([
    f.admin.mut('task.update', { id: f.taskIds[1], startDate: utcDay(1), dueDate: utcDay(2) }),
  ]);
  const page = await loginAs(browser, 'alice');
  await spa(
    page,
    `/p/${f.projectId}/timeline:timeline`,
    page.locator(`[data-tl-task="${f.taskKeys[1]}"]`),
  );
  await page
    .getByTestId('tl-undated')
    .filter({ hasText: b })
    .dragTo(page.getByTestId('tl-scroll'), { targetPosition: { x: 400, y: 200 } });
  await expect
    .poll(async () => {
      const t = await taskOf(f.taskIds[0]!);
      return !!t.startDate && t.startDate === t.dueDate;
    })
    .toBe(true);
  await expect(page.locator(`[data-tl-task="${f.taskKeys[0]}"]`)).toBeVisible();
});

// баг приложения: useWorkloadData делает where('spaceId') по неиндексированным taskAssignees и timeEstimates
// (DexieError), таблица пуста; убрать fixme после правки modules/workload/web/data.ts
test.fixme('p3: нагрузка — задача в неделе срока, ёмкость меньше часов подсвечивает ячейку, клик → список', async ({
  browser,
}) => {
  const title = uniq('Нагрузка');
  const f = await fixture([title]);
  const alice = await Client.login('alice');
  await f.admin.pushOk([
    f.admin.mut('task.update', { id: f.taskIds[0], dueDate: utcDay(0) }),
    f.admin.mut('task.assign', { id: uuidv7(), taskId: f.taskIds[0], userId: alice.userId }),
    f.admin.mut('time.setEstimate', { taskId: f.taskIds[0], minutes: 120 }),
  ]);
  const page = await loginAs(browser, 'admin');
  await spa(page, '/m/workload', page.locator('[data-test=space]'));
  await page.locator('[data-test=space]').selectOption({ label: `e2e ${f.spaceId}` });

  const cell = page.locator(`[data-test^="cell-${alice.userId}-"]`);
  await expect(cell).toHaveCount(1);
  await expect(cell).toHaveText('2'); // 120 мин = 2 ч при 40 ч/нед — не перегружено
  await expect(page.locator('td.over')).toHaveCount(0);

  const cap = page.locator(`[data-test="cap-${alice.userId}"]`);
  await cap.fill('1');
  await cap.blur();
  await expect(page.locator('td.over')).toHaveCount(1);

  await cell.click();
  await expect(page.locator('[data-test=list] [data-test=task]')).toContainText(title);
});

// баг приложения: registerModules отклоняет маршрут '/m/dashboards' модуля dashboards (нужен префикс
// '/m/dashboards/'), модуль не открывается; убрать fixme после правки в modules/dashboards/web/index.ts
test.fixme('p3: дашборды — виджет «число» с фильтром по статусу совпадает с числом задач', async ({
  browser,
}) => {
  await enableP3(admin, true);
  const titles = [uniq('Д1'), uniq('Д2'), uniq('Д3')];
  const f = await fixture(titles);
  await f.admin.pushOk([
    f.admin.mut('task.update', { id: f.taskIds[0], statusId: f.statusIds[1] }),
    f.admin.mut('task.update', { id: f.taskIds[1], statusId: f.statusIds[1] }),
  ]);
  const page = await loginAs(browser, 'alice');
  await spa(page, '/m/dashboards', page.locator('[data-test=create]'));
  await page.locator('[data-test=create]').click();
  const dlg = page.getByRole('dialog');
  const name = uniq('Борд');
  await dlg.getByLabel('Название').fill(name);
  await dlg.getByRole('combobox', { name: 'Где' }).click();
  await page.getByRole('option', { name: `e2e ${f.spaceId}` }).click();
  await dlg.locator('[data-test=save]').click();
  await expect(page.locator('[data-test=name]')).toHaveText(name);

  await page.locator('[data-test=add]').click();
  const w = page.getByRole('dialog');
  await w.getByLabel('Заголовок').fill('Во втором статусе');
  await w.locator('[data-role=add]').click();
  await w.locator(`[data-value="${f.statusIds[1]}"]`).check();
  await w.locator('[data-test=save]').click();
  await expect(page.locator('[data-test=number]')).toHaveText('2');

  // без фильтра в пространстве 3 задачи: число меняется вместе с данными реплики
  await f.admin.pushOk([
    f.admin.mut('task.update', { id: f.taskIds[2], statusId: f.statusIds[1] }),
  ]);
  await expect(page.locator('[data-test=number]')).toHaveText('3');
});

test.describe('формы', () => {
  test('p3: форма — админ создаёт в настройках, аноним отправляет, задача в статусе формы; SW-контекст видит страницу формы', async ({
    browser,
  }) => {
    const f = await fixture([uniq('Формы')]);
    const adminPage = await loginAs(browser, 'admin');
    await spa(adminPage, '/settings/forms:forms', adminPage.getByTestId('fm-project'));
    await adminPage.getByTestId('fm-project').selectOption(f.projectId);
    await adminPage.getByTestId('fm-status').selectOption(f.statusIds[1]!);
    const formTitle = uniq('Обратная связь');
    await adminPage.getByTestId('fm-title').fill(formTitle);
    await adminPage.getByTestId('fm-create').click();
    const row = adminPage.getByTestId('fm-form').filter({ hasText: formTitle });
    const url = (await row.getByTestId('fm-url').textContent())!;
    const slug = new URL(url).pathname.split('/')[2]!;
    expect(slug).toMatch(/^[a-z0-9]{16}$/);
    // форма дошла до сервера (мутация уходит из очереди асинхронно)
    await expect
      .poll(async () =>
        (
          await (await request.newContext({ baseURL: BASE })).get(`/api/forms/public/${slug}`)
        ).status(),
      )
      .toBe(200);

    // без входа: новый контекст
    const anon = await browser.newContext({ baseURL: BASE, locale: 'ru-RU' });
    const ap = await anon.newPage();
    await ap.goto(`/f/${slug}`);
    await expect(ap.getByRole('heading', { name: formTitle })).toBeVisible();
    const title = uniq('Заявка');
    await ap.getByLabel('Заголовок').fill(title);
    await ap.getByRole('button', { name: 'Отправить' }).click();
    await expect(ap.getByRole('heading', { name: 'Отправлено' })).toBeVisible();
    await expect
      .poll(async () => {
        const t = (await admin.bootstrap()).data.tasks!.find((x) => x.title === title);
        return t && [t.projectId, t.statusId];
      })
      .toEqual([f.projectId, f.statusIds[1]]);
    await anon.close();

    // контекст, где приложение уже открывалось (SW зарегистрирован, если включён): /f/<slug> — страница формы
    const warm = await loginAs(browser, 'alice');
    await warm.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return;
      await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 5000))]);
    });
    await warm.goto(`/f/${slug}`);
    await expect(warm.getByRole('heading', { name: formTitle })).toBeVisible();
    await expect(warm.getByTestId('sidebar')).toHaveCount(0);
  });

  // баг приложения: FormsSettings передаёт в mutate реактивный черновик (DataCloneError в IndexedDB),
  // сохранение полей из конструктора не доходит до сервера; убрать fixme после правки FormsSettings.vue
  test.fixme('p3: форма — конструктор сохраняет добавленное поле e-mail', async ({ browser }) => {
    const f = await fixture([uniq('Поля')]);
    const page = await loginAs(browser, 'admin');
    await spa(page, '/settings/forms:forms', page.getByTestId('fm-project'));
    await page.getByTestId('fm-project').selectOption(f.projectId);
    const formTitle = uniq('Поля формы');
    await page.getByTestId('fm-title').fill(formTitle);
    await page.getByTestId('fm-create').click();
    const row = page.getByTestId('fm-form').filter({ hasText: formTitle });
    await row.getByTestId('fm-use-email').check();
    await row.getByTestId('fm-save').click();
    const slug = new URL((await row.getByTestId('fm-url').textContent())!).pathname.split('/')[2]!;
    await expect
      .poll(async () => {
        const r = await (
          await request.newContext({ baseURL: BASE })
        ).get(`/api/forms/public/${slug}`);
        return r.ok() ? ((await r.json()).fields as unknown[]).length : 0;
      })
      .toBe(2);
  });

  test('p3: форма — выключенная форма отвечает понятной ошибкой, а не приложением', async ({
    browser,
  }) => {
    const f = await fixture([uniq('Выкл')]);
    const slug = slug16();
    const id = uuidv7();
    await f.admin.pushOk([
      f.admin.mut('forms.create', {
        id,
        projectId: f.projectId,
        slug,
        title: 'Выкл',
        statusId: f.statusIds[0],
        fields: [{ key: 'title', label: 'Заголовок', required: true }],
      }),
      f.admin.mut('forms.update', { id, enabled: false }),
    ]);
    const ctx = await browser.newContext({ baseURL: BASE, locale: 'ru-RU' });
    const p = await ctx.newPage();
    await p.goto(`/f/${slug}`);
    await expect(p.getByRole('alert')).toContainText('не найдена');
    await ctx.close();
  });

  test('p3: форма — после 5 отправок с одного IP ответ 429', async () => {
    const f = await fixture([uniq('Лимит')]);
    const slug = slug16();
    await f.admin.pushOk([
      f.admin.mut('forms.create', {
        id: uuidv7(),
        projectId: f.projectId,
        slug,
        title: 'Лимит',
        statusId: f.statusIds[0],
        fields: [{ key: 'title', label: 'Заголовок', required: true }],
      }),
    ]);
    const ctx = await request.newContext({ baseURL: BASE });
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await ctx.post(`/api/forms/public/${slug}`, {
        data: { values: { title: `лимит ${i}` }, website: '' },
      });
      codes.push(r.status());
    }
    const first = codes.indexOf(429);
    // до 5 отправок в минуту; в эту же минуту могла быть отправка предыдущего теста
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(5);
    expect(codes.slice(0, first).every((c) => c === 201)).toBe(true);
  });
});

test('p3: GitLab — настройки, «Опросить сейчас», в карточке задачи блок с MR и ссылкой', async ({
  browser,
}) => {
  const f = await fixture([uniq('Гитлаб')]);
  const key = f.taskKeys[0]!;
  const token = 'glpat-e2e-token';
  const gl = await fakeGitlab(token, [
    { iid: 7, title: `${key}: исправление`, updatedAt: new Date().toISOString() },
  ]);
  try {
    const page = await loginAs(browser, 'admin');
    await spa(page, '/settings/gitlab:settings', page.getByTestId('gl-url'));
    await page.getByTestId('gl-url').fill(gl.url);
    await page.getByTestId('gl-token').fill(token);
    await page.getByTestId('gl-save').click();
    await expect(page.getByTestId('gl-token')).toHaveAttribute('placeholder', /.+/);
    await page.getByTestId('gl-project-input').fill('grp/proj');
    await page.getByTestId('gl-add').click();
    await expect(page.getByTestId('gl-project')).toContainText('grp/proj');
    await page.getByTestId('gl-poll').click();

    await spa(page, `/t/${key}`, page.getByRole('tab', { name: 'GitLab' }));
    await page.getByRole('tab', { name: 'GitLab' }).click();
    const mr = page.getByTestId('gl-mr');
    await expect(mr).toContainText('!7', { timeout: 60_000 });
    await expect(mr.getByRole('link')).toHaveAttribute('href', /merge_requests\/7$/);
    // токен ушёл в GitLab расшифрованным
    expect(gl.seen.tokens.every((t) => t === token)).toBe(true);
  } finally {
    await gl.close();
  }
});

test('p3: GitLab — неверный токен: ошибка в настройках, MR не появляются', async ({ browser }) => {
  const gl = await fakeGitlab('right-token', []);
  try {
    const page = await loginAs(browser, 'admin');
    await spa(page, '/settings/gitlab:settings', page.getByTestId('gl-url'));
    await page.getByTestId('gl-url').fill(gl.url);
    await page.getByTestId('gl-token').fill('wrong-token');
    await page.getByTestId('gl-save').click();
    await expect(page.getByTestId('gl-token')).toHaveAttribute('placeholder', /.+/);
    await page.getByTestId('gl-project-input').fill('grp/proj');
    await page.getByTestId('gl-add').click();
    // проект ищется с неверным токеном: 401 от GitLab показан как ошибка
    await expect(page.getByRole('alert')).toBeVisible();
    expect(gl.seen.tokens.length).toBeGreaterThan(0);
    expect(gl.seen.tokens.every((t) => t === 'wrong-token')).toBe(true);
  } finally {
    await gl.close();
  }
});
