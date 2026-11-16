import { expect, test } from '@playwright/test';
import { appUrl } from '../../packages/shared/src/aikb/urls.js';
import { uuidv7 } from '../lib.js';
import { fixture, loginAs, uniq } from './helpers.js';

// PLNRAPP-234: ссылки, собранные appUrl по адресу стенда, открывают задачу и документ.
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

test('appUrl: задача и документ открываются по собранному URL', async ({ browser }) => {
  const title = uniq('Задача по ссылке');
  const f = await fixture([title]);
  const docTitle = uniq('Документ по ссылке');
  const pageId = uuidv7();
  await f.admin.pushOk([
    f.admin.mut('docs.page.create', {
      id: pageId,
      spaceId: f.spaceId,
      rank: 'a0',
      title: docTitle,
    }),
  ]);
  const alice = await loginAs(browser, 'alice');

  await alice.goto(appUrl(BASE, { kind: 'task', key: f.taskKeys[0]! }));
  await expect(alice.getByText(title).first()).toBeVisible();

  await alice.goto(appUrl(`${BASE}/`, { kind: 'doc', pageId }));
  await expect(alice.getByText(docTitle).first()).toBeVisible();
});
