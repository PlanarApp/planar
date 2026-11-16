import { expect, test } from '@playwright/test';
import { Client, uuidv7 } from '../lib.js';
import { fixture, loginAs } from './helpers.js';
import { textDoc } from './collab-helpers.js';

// PLNRAPP-214: клик по назначенному комментарию в «Моей работе» — карточка, прокрутка к комментарию, мигание
test('PLNRAPP-214: «Комментарии мне» → комментарий в ленте и подсветка; ответ в глубокой ветке — в треде', async ({
  browser,
}) => {
  const f = await fixture(['Переход к комментарию']);
  const alice = await Client.login('alice');
  const [taskId] = f.taskIds;
  const top = uuidv7();
  const reply = uuidv7();
  const deep = uuidv7();
  const assigned = uuidv7();
  const mk = (id: string, text: string, extra: object = {}) =>
    f.admin.mut('comment.create', { id, taskId: taskId!, body: textDoc(text), ...extra });
  await f.admin.pushOk([
    // старый назначенный комментарий — под кучей новых, без прокрутки его не видно
    mk(assigned, 'Назначенный наверху', { assigneeId: alice.userId }),
    ...Array.from({ length: 12 }, (_, i) => mk(uuidv7(), `Заполнитель ${i}`)),
    mk(top, 'Корень ветки'),
    mk(reply, 'Ответ', { parentId: top }),
    mk(deep, 'Глубокий ответ мне', { parentId: reply, assigneeId: alice.userId }),
  ]);

  const page = await loginAs(browser, 'alice');
  await page.setViewportSize({ width: 1280, height: 600 });
  const flashed = async (id: string) => {
    const el = page.locator(`[data-comment="${id}"]`).first();
    await expect(el).toHaveClass(/comment-flash/);
    await expect(el).toBeInViewport();
  };
  for (const [id, text] of [
    [assigned, 'Назначенный наверху'],
    [deep, 'Глубокий ответ мне'],
  ] as const) {
    await page.goto('/w/work?w=comments');
    await page
      .getByTestId('work-comment')
      .filter({ hasText: text })
      .getByRole('button')
      .nth(1)
      .click();
    await expect(page.getByTestId('feed')).toBeAttached();
    await flashed(id);
  }
  // глубокий ответ — в треде своего родителя
  await expect(page.getByTestId('thread-view')).toBeVisible();
});
