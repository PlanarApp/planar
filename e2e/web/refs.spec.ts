import { expect, test } from '@playwright/test';
import { uuidv7 } from '../lib.js';
import { fixture, loginAs, uniq } from './helpers.js';

test('PJ-13: @@ в комментарии — выбор задачи, @@@ — выбор документа', async ({ browser }) => {
  const f = await fixture([uniq('Целевая задача'), uniq('Источник')]);
  const docTitle = uniq('Регламент');
  await f.admin.pushOk([
    f.admin.mut('docs.page.create', {
      id: uuidv7(),
      spaceId: f.spaceId,
      rank: 'a0',
      title: docTitle,
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
    }),
  ]);
  const alice = await loginAs(browser, 'alice');
  await alice.goto(`/t/${f.taskKeys[1]}`);
  const editor = alice.getByRole('textbox', { name: /Написать комментарий/ });
  await editor.click();

  await editor.pressSequentially('см. @@');
  await alice.getByTestId('ref-search').fill(f.taskKeys[0]!);
  await alice.getByTestId('ref-option').first().click();
  await expect(editor.locator(`a[href="/t/${f.taskKeys[0]}"]`)).toBeVisible();

  await editor.pressSequentially('и @@');
  await alice.getByTestId('ref-search').fill('@');
  await alice.getByTestId('ref-search').fill(docTitle);
  await alice.getByTestId('ref-option').first().click();
  await expect(editor.locator('a[href^="/m/docs/"]')).toBeVisible();

  await alice.getByTestId('comment-send').click();
  const c = alice.getByTestId('comment');
  await expect(c.locator(`a[href="/t/${f.taskKeys[0]}"]`)).toBeVisible();
  await expect(c.locator('a[href^="/m/docs/"]')).toBeVisible();
});
