import path from 'node:path';
import { expect, test } from '@playwright/test';
import { Client, uuidv7 } from '../lib.js';
import { fixture, loginAs, pick, uniq } from './helpers.js';
import { enableModules, receiver, signatureOk, utcDay } from './work-helpers.js';

test.beforeAll(async () => {
  await enableModules(await Client.login('admin'));
});

test('время: таймер в панели задачи и верхней панели, запись, неделя «Мои часы»', async ({
  browser,
}) => {
  const title = uniq('Учёт времени');
  const f = await fixture([title]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/t/${f.taskKeys[0]}`);
  await page.getByRole('tab', { name: 'Время' }).click();
  await page.locator('[data-test=toggle]').click();
  const top = page.locator('[data-test=topbar-timer]');
  await expect(top).toBeVisible();
  const t0 = await top.locator('.mono').textContent();
  await expect.poll(() => top.locator('.mono').textContent()).not.toBe(t0);
  await top.click(); // стоп из верхней панели
  await expect(top).toHaveCount(0);
  await expect(page.locator('[data-test=entry]')).toHaveCount(1);

  await page.locator('[data-test=dur]').fill('1:30');
  await page.locator('[data-test=add]').click();
  await expect(page.locator('[data-test=entry]')).toHaveCount(2);
  await expect(page.locator('[data-test=sum] b')).toHaveText('1:30');

  await page.getByTestId('sidebar').getByRole('link', { name: 'Мои часы' }).click();
  await expect(page).toHaveURL(/\/m\/time\/week/);
  const row = page.locator('[data-test=row]', { hasText: title });
  const total = row.locator('td.total');
  await expect(total).toHaveText('1:30');
  await row.locator('.cell:not(.empty) input').fill('2:00');
  await row.locator('.cell:not(.empty) input').blur();
  await expect(total).toHaveText('2:00');
});

test('спринт: «Закрыть» переносит незакрытые задачи в следующий цикл, done остаётся', async ({
  browser,
}) => {
  const [todo, done] = [uniq('Не закрыта'), uniq('Закрыта')];
  const f = await fixture([todo, done]);
  const cycleId = uuidv7();
  await f.admin.pushOk([
    f.admin.mut('sprints.configure', { projectId: f.projectId, enabled: true, timezone: 'UTC' }),
    f.admin.mut('sprints.create', {
      id: cycleId,
      projectId: f.projectId,
      // пояс проекта UTC, запас в обе стороны: не зависит от полуночи
      startDate: utcDay(-1),
      endDate: utcDay(7),
    }),
    f.admin.mut('sprints.setTask', { taskId: f.taskIds[0], cycleId }),
    f.admin.mut('sprints.setTask', { taskId: f.taskIds[1], cycleId }),
    f.admin.mut('task.update', { id: f.taskIds[0], statusId: f.statusIds[1] }),
    f.admin.mut('task.update', { id: f.taskIds[1], statusId: f.statusIds[3] }),
  ]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/p/${f.projectId}`);
  await page.getByRole('tab', { name: 'Спринт' }).click();
  await expect(page.getByTestId('sprint-current')).toBeVisible();
  await page.locator('[data-role=close]').click();
  await expect(page.getByTestId('sprint-none')).toBeVisible();

  const cycles = async () => {
    const { data } = await f.admin.bootstrap();
    return data.sprintsCycles!.filter((c) => c.projectId === f.projectId);
  };
  await expect.poll(async () => (await cycles()).length).toBe(2);
  const [c1, c2] = (await cycles()).sort((a, b) => (a.number as number) - (b.number as number));
  expect(c1!.closedAt).toBeTruthy();
  expect(c2!.startDate).toBe(utcDay(8));
  const { data } = await f.admin.bootstrap();
  const cy = (id: string) => data.tasks!.find((t) => t.id === id)!.cycleId;
  expect(cy(f.taskIds[0]!)).toBe(c2!.id);
  expect(cy(f.taskIds[1]!)).toBe(cycleId);
});

test('спринт: холодная загрузка прямой ссылки рисует экран модуля, а не заглушку', async ({
  browser,
}) => {
  const f = await fixture([uniq('Для ссылки')]);
  await f.admin.pushOk([
    f.admin.mut('sprints.configure', { projectId: f.projectId, enabled: true, timezone: 'UTC' }),
  ]);
  const page = await loginAs(browser, 'alice');
  await page.goto(`/p/${f.projectId}/sprints:sprint`);
  await expect(
    page.getByTestId('sprint-current').or(page.getByTestId('sprint-none')),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Модуль:/ })).toHaveCount(0);
});

test('автоматизация: смена статуса → webhook с верной подписью', async ({ browser }) => {
  const f = await fixture([uniq('Для правила')]);
  const rcv = await receiver();
  try {
    const r = await f.admin.ctx.post('/api/webhooks/subscriptions', {
      data: { url: rcv.url, events: ['task.created'] },
    });
    expect(r.status()).toBe(201);
    const { data: sub, secret } = await r.json();
    await f.admin.pushOk([
      f.admin.mut('automations.create', {
        id: uuidv7(),
        projectId: f.projectId,
        name: uniq('Правило'),
        trigger: { type: 'task.status_changed' },
        actions: [{ type: 'send_webhook', subscriptionId: sub.id }],
      }),
    ]);
    const page = await loginAs(browser, 'alice');
    await page.goto(`/p/${f.projectId}/board`);
    const card = page.locator(`[data-col="${f.statusIds[0]}"] [data-id="${f.taskIds[0]}"]`);
    const target = page.locator(`[data-col="${f.statusIds[1]}"]`);
    await expect(card).toBeVisible();
    await expect(target).toBeVisible();
    await card.dragTo(target);
    await expect(
      page.locator(`[data-col="${f.statusIds[1]}"] [data-id="${f.taskIds[0]}"]`),
    ).toBeVisible();
    await expect.poll(() => rcv.hits.length, { timeout: 30_000 }).toBeGreaterThan(0);
    const hit = rcv.hits.find((h) => h.headers['x-planar-event'] === 'automation.fired')!;
    expect(hit).toBeTruthy();
    expect(signatureOk(secret, hit.body, hit.headers['x-planar-signature'] as string)).toBe(true);
    expect(JSON.parse(hit.body).data.task.id).toBe(f.taskIds[0]);
  } finally {
    await rcv.close();
  }
});

test('импорт: jira.csv по заготовке, прогресс до конца, задачи видны в проекте', async ({
  browser,
}) => {
  const f = await fixture([]);
  const page = await loginAs(browser, 'admin');
  await page.goto('/m/import/');
  await page
    .locator('input[type=file]')
    .setInputFiles(path.resolve(import.meta.dirname, '../fixtures/import/jira.csv'));
  await pick(page.getByRole('combobox', { name: 'Источник' }), 'jira');
  await page.locator('.import-next').click();
  await pick(page.locator('.import-project').getByRole('combobox'), `E2E ${f.key}`);
  await page.locator('.import-start').click();
  await expect(page.locator('.import-status-line')).toContainText('8 / 8', {
    timeout: 30_000,
  });
  await expect(page.locator('progress')).toHaveAttribute('value', '8');
  await page.goto(`/p/${f.projectId}`);
  // подзадачи (6–8) в списке свёрнуты под родителем — проверяем верхний уровень и число на сервере
  for (const n of [1, 5]) await expect(page.getByText(`Jira issue ${n}`).first()).toBeVisible();
  const { data } = await f.admin.bootstrap();
  expect(data.tasks!.filter((t) => t.projectId === f.projectId)).toHaveLength(8);
});

test('настройки: страница автоматизаций открывается и показывает правило', async ({ browser }) => {
  const f = await fixture([]);
  const name = uniq('Видимое правило');
  await f.admin.pushOk([
    f.admin.mut('automations.create', {
      id: uuidv7(),
      projectId: f.projectId,
      name,
      trigger: { type: 'task.created' },
      actions: [{ type: 'add_comment', text: 'привет' }],
    }),
  ]);
  const page = await loginAs(browser, 'admin');
  await page.goto('/settings');
  await page.getByTestId('nav-automations:rules').click();
  await expect(page.getByTestId('automations-page')).toBeVisible();
  await pick(page.locator('[data-role=project]').getByRole('combobox'), `E2E ${f.key}`);
  await expect(page.locator('[data-role=rule]', { hasText: name })).toBeVisible();
});
