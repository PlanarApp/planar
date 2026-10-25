import { expect, test, type Page } from '@playwright/test';
import { Client, ranks, uuidv7 } from '../lib.js';
import { fixture, loginAs, uniq } from './helpers.js';
import { MODULES, setModules, spaGo } from './collab-helpers.js';

let admin: Client;
test.beforeAll(async () => {
  admin = await Client.login('admin');
  await setModules(admin, MODULES);
});

/** Страница docs в пространстве фикстуры. */
async function mkPage(f: Awaited<ReturnType<typeof fixture>>, title: string): Promise<string> {
  const id = uuidv7();
  await f.admin.pushOk([
    f.admin.mut('docs.page.create', { id, spaceId: f.spaceId, rank: ranks(1)[0], title }),
  ]);
  return id;
}
const docBody = (p: Page) => p.getByRole('textbox', { name: 'Текст страницы' });
const taskBody = (p: Page) => p.getByRole('textbox', { name: 'Описание' });

const go = (p: Page, url: string) => (url.startsWith('/m/') ? spaGo(p, url) : p.goto(url));

async function pair(browser: Parameters<typeof loginAs>[0], url: string, box: typeof docBody) {
  const alice = await loginAs(browser, 'alice');
  const bob = await loginAs(browser, 'bob');
  await Promise.all([go(alice, url), go(bob, url)]);
  await Promise.all([expect(box(alice)).toBeEditable(), expect(box(bob)).toBeEditable()]);
  return { alice, bob };
}

test('collab-edit: ввод alice в документе docs виден bob ≤ 500 мс, без плашки блокировки', async ({
  browser,
}) => {
  const f = await fixture([uniq('Док')]);
  const id = await mkPage(f, uniq('Совместный'));
  const { alice, bob } = await pair(browser, `/m/docs/${id}`, docBody);
  const text = `слово${uuidv7().slice(-10)}`;
  await docBody(alice).click();
  await docBody(alice).pressSequentially(text);
  await expect(docBody(bob)).toContainText(text, { timeout: 500 });
  await expect(bob.getByTestId('doc-lock')).toHaveCount(0);
  // встречная правка
  await docBody(bob).click();
  await bob.keyboard.press('Control+End');
  await bob.keyboard.type(' ответ');
  await expect(docBody(alice)).toContainText(`${text} ответ`, { timeout: 500 });
});

test('collab-edit: описание задачи правится двумя участниками, изменение ≤ 500 мс', async ({
  browser,
}) => {
  const f = await fixture([uniq('Задача')]);
  const { alice, bob } = await pair(browser, `/t/${f.taskKeys[0]}`, taskBody);
  const text = `описание${uuidv7().slice(-10)}`;
  await taskBody(alice).click();
  await taskBody(alice).pressSequentially(text);
  await expect(taskBody(bob)).toContainText(text, { timeout: 500 });
});

test('collab-edit: курсор bob с именем виден alice', async ({ browser }) => {
  const f = await fixture([uniq('Курсор')]);
  const id = await mkPage(f, uniq('Курсоры'));
  const { alice, bob } = await pair(browser, `/m/docs/${id}`, docBody);
  await docBody(bob).click();
  await bob.keyboard.type('x');
  await expect(alice.locator('.collaboration-carets__label', { hasText: 'Bob' })).toBeVisible();
});

test('collab-edit: офлайн-правка alice доходит до bob после возвращения сети', async ({
  browser,
}) => {
  const f = await fixture([uniq('Офлайн')]);
  const id = await mkPage(f, uniq('Офлайн'));
  const { alice, bob } = await pair(browser, `/m/docs/${id}`, docBody);
  const ctx = alice.context();
  await ctx.setOffline(true);
  const text = `офлайн${uuidv7().slice(-10)}`;
  await docBody(alice).click();
  await docBody(alice).pressSequentially(text);
  await expect(docBody(alice)).toContainText(text);
  await new Promise((r) => setTimeout(r, 1000));
  await expect(docBody(bob)).not.toContainText(text);
  await ctx.setOffline(false);
  await expect(docBody(bob)).toContainText(text, { timeout: 20_000 });
});

test('collab-edit: после правки и debounce Cmd+K находит новый текст (проекция)', async ({
  browser,
}) => {
  const f = await fixture([uniq('Поиск')]);
  const title = uniq('Искомая');
  const id = await mkPage(f, title);
  const alice = await loginAs(browser, 'alice');
  await spaGo(alice, `/m/docs/${id}`);
  const word = `поиск${uuidv7().slice(-10)}`;
  await docBody(alice).click();
  await docBody(alice).pressSequentially(word);
  await expect
    .poll(
      async () =>
        JSON.stringify(
          ((await f.admin.bootstrap()).data.docsPages ?? []).find((p) => p.id === id)?.text,
        ),
      { timeout: 20_000 },
    )
    .toContain(word);
  await alice.getByRole('link', { name: 'Моя работа' }).first().click();
  await alice.keyboard.press('Control+k');
  await alice.getByRole('dialog').getByRole('textbox').fill(word);
  await expect(alice.getByRole('option').filter({ hasText: title })).toBeVisible();
});

test('collab-edit: страница, ещё не дошедшая до сервера, подключается после push — набор доходит до bob', async ({
  browser,
}) => {
  const f = await fixture([uniq('Новая')]);
  const alice = await loginAs(browser, 'alice');
  await alice.goto(`/s/${f.spaceId}/docs`);
  await expect(alice.getByTestId('group-docs')).toBeVisible();
  // push страницы задержан: collab-подключение сначала получает отказ
  await alice.route('**/sync/push', async (r) => {
    await new Promise((x) => setTimeout(x, 4000));
    await r.continue();
  });
  await alice
    .getByTestId('group-docs')
    .locator('div.group', { hasText: `e2e ${f.spaceId}` })
    .getByRole('button', { name: 'Новая страница' })
    .click();
  await expect(alice).toHaveURL(/page=/);
  const title = uniq('Свежая');
  await alice.getByTestId('doc-title').fill(title);
  const text = `свежее${uuidv7().slice(-10)}`;
  await docBody(alice).click();
  await docBody(alice).pressSequentially(text);
  await alice.context().setOffline(false);
  await expect
    .poll(
      async () =>
        ((await f.admin.bootstrap()).data.docsPages ?? []).find((p) => p.title === title)?.id,
      {
        timeout: 20_000,
      },
    )
    .toBeTruthy();
  const id = ((await f.admin.bootstrap()).data.docsPages ?? []).find((p) => p.title === title)!
    .id as string;
  const bob = await loginAs(browser, 'bob');
  await spaGo(bob, `/m/docs/${id}`);
  await expect(docBody(bob)).toContainText(text, { timeout: 20_000 });
  await docBody(alice).pressSequentially('z');
  // awareness пережил повторное подключение: курсор alice виден bob
  await expect(bob.locator('.collaboration-carets__label', { hasText: 'Alice' })).toBeVisible();
});
