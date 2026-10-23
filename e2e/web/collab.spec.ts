import { expect, test, type Page } from '@playwright/test';
import { Client, uuidv7 } from '../lib.js';
import { fixture, loginAs, uniq } from './helpers.js';
import {
  carol,
  channel,
  dm,
  MODULES,
  sendMsg,
  setModules,
  status,
  upload,
} from './collab-helpers.js';

let admin: Client;
test.beforeAll(async () => {
  admin = await Client.login('admin');
  await setModules(admin, MODULES);
});
test.afterEach(() => setModules(admin, MODULES));

// корень секций модуля перекрывается data-testid=nav-section ядра: ищем по заголовку
const chatNav = (p: Page) => p.getByRole('heading', { name: 'Чат', level: 2 });
const docsNav = (p: Page) =>
  p
    .getByTestId('nav-section')
    .filter({ has: p.getByRole('heading', { name: 'Документы', level: 2 }) });
// goto по url модуля при холодной загрузке показывает заглушку «Модуль» (см. fixme ниже): переходим как SPA
const spa = async (p: Page, url: string) => {
  await expect(chatNav(p)).toBeVisible(); // маршруты модуля добавляются после загрузки реплики
  await p.evaluate((u) => {
    history.pushState({}, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, url);
};
const lines = (c: Client) => c.bootstrap().then((b) => b.data);

test('collab: сообщение с упоминанием доходит до bob ≤ 2 с, уведомление chat_mention в Inbox ведёт по url', async ({
  browser,
}) => {
  const f = await fixture([uniq('Чат')]);
  const ch = await channel(f.admin, f, uniq('канал'));
  const alice = await loginAs(browser, 'alice');
  const bob = await loginAs(browser, 'bob');
  await Promise.all([spa(alice, `/m/chat/c/${ch}`), spa(bob, `/m/chat/c/${ch}`)]);
  const feed = bob.getByTestId('chat-feed');
  await expect(feed).toBeVisible();

  const text = uniq('привет');
  const box = alice.getByTestId('chat-composer').getByRole('textbox');
  await box.click();
  await box.pressSequentially('@Bob');
  await alice.getByRole('listbox').getByRole('option').first().click();
  await box.pressSequentially(` ${text}`);
  await box.press('Enter');
  await expect(feed.getByText(text)).toBeVisible({ timeout: 2000 });

  // push (Web Push) покрыт api-тестами CL-1b; здесь — строка уведомления
  await bob.goto('/inbox');
  const item = bob.getByTestId('inbox-item').filter({ hasText: text });
  await expect(item).toContainText('упомянул(а) вас в чате');
  await item.getByRole('button').first().click();
  await expect(bob).toHaveURL(new RegExp(`/m/chat/c/${ch}/`));
  await expect(bob.getByTestId('chat-feed').getByText(text)).toBeVisible();
});

test('collab: личный диалог невиден третьему (UI, bootstrap, pull, WS, /files, REST)', async ({
  browser,
}) => {
  const f = await fixture([uniq('Диалог')]);
  const c = await carol(f.admin, f);
  const [alice, bob] = await Promise.all([Client.login('alice'), Client.login('bob')]);
  const id = await dm(alice, bob);
  const text = uniq('секрет');
  const sha = await upload(alice, 'a.txt', uniq('файл'));
  await sendMsg(alice, id, text, {
    attachments: [{ fileSha256: sha, name: 'a.txt', mime: 'text/plain', size: 10 }],
  });

  const cp = await loginAs(browser, 'carol-e2e');
  await expect(chatNav(cp)).toBeVisible();
  await expect(cp.getByTestId('chat-dm')).toHaveCount(0);
  await spa(cp, `/m/chat/c/${id}`);
  await expect(cp.getByTestId('chat-page')).toBeVisible();
  await expect(cp.getByText(text)).toHaveCount(0);

  const boot = await lines(c);
  expect((boot.chatChannels ?? []).some((r) => r.id === id)).toBe(false);
  expect((boot.chatMembers ?? []).some((r) => r.channelId === id)).toBe(false);
  const pull = await c.pull(0);
  const mine = pull.changes.filter((x) =>
    ['chatChannels', 'chatMessages', 'chatMembers'].includes(x.entity),
  );
  expect(JSON.stringify(mine)).not.toContain(id);
  expect(JSON.stringify(mine)).not.toContain(text);

  expect(await status(c, `/files/${sha}`)).toBe(404);
  expect(await status(c, `/api/chat/channels/${id}/messages`)).toBe(404);
  expect(await status(bob, `/files/${sha}`)).toBe(200);
  expect(await status(bob, `/api/chat/channels/${id}/messages`)).toBe(200);

  // WS: «печатает» по диалогу получает bob, carol — нет
  const [wb, wc, wa] = await Promise.all([bob.ws(0), c.ws(0), alice.ws(0)]);
  wa.sock.send(JSON.stringify({ t: 'typing', entity: 'chatChannels', id }));
  await expect
    .poll(() => wb.messages.some((m) => m.t === 'typing' && m.id === id), { timeout: 5000 })
    .toBe(true);
  await new Promise((r) => setTimeout(r, 1000));
  expect(wc.messages.some((m) => m.t === 'typing')).toBe(false);
  [wa, wb, wc].forEach((w) => w.close());
});

test('collab: вышедший из диалога не получает новых сообщений (UI, pull, REST)', async ({
  browser,
}) => {
  const f = await fixture([uniq('Выход')]);
  const [alice, bob] = await Promise.all([Client.login('alice'), Client.login('bob')]);
  const id = await dm(alice, bob);
  await sendMsg(alice, id, uniq('до выхода'));
  const bp = await loginAs(browser, 'bob');
  await spa(bp, `/m/chat/c/${id}`);
  await expect(bp.getByTestId('chat-feed')).toBeVisible();

  await bob.pushOk([bob.mut('chat.dm.leave', { channelId: id })]);
  const cursor = (await bob.bootstrap()).cursor;
  const text = uniq('после выхода');
  await sendMsg(alice, id, text);
  await expect(async () => {
    const p = await bob.pull(cursor);
    expect(JSON.stringify(p.changes)).not.toContain(text);
  }).toPass({ timeout: 3000 });
  await new Promise((r) => setTimeout(r, 1500));
  expect(JSON.stringify((await bob.pull(cursor)).changes)).not.toContain(text);
  expect(await status(bob, `/api/chat/channels/${id}/messages`)).toBe(404);
  await bp.reload();
  await expect(bp.getByText(text)).toHaveCount(0);
  void f;
});

test('collab: документ создаётся в дереве, связывается с задачей, ищется в Cmd+K', async ({
  browser,
}) => {
  const f = await fixture([uniq('Для документа')]);
  const page = await loginAs(browser, 'alice');
  const title = uniq('Страница');
  const word = `слово${uuidv7().slice(-10)}`;

  const tree = docsNav(page);
  await tree
    .locator('div.group', { hasText: `e2e ${f.spaceId}` })
    .getByRole('button', { name: 'Новая страница' })
    .click();
  await expect(page).toHaveURL(/\/m\/docs\//);
  await page.getByTestId('doc-title').fill(title);
  const body = page.getByRole('textbox', { name: 'Текст страницы' });
  await body.click();
  await body.pressSequentially(`текст ${word}`);
  await expect
    .poll(async () =>
      JSON.stringify(((await lines(f.admin)).docsPages ?? []).find((p) => p.title === title)?.text),
    )
    .toContain(word);

  await page.goto(`/t/${f.taskKeys[0]}`);
  await page.getByRole('tab', { name: 'Документы' }).click();
  const panel = page.getByTestId('docs-panel');
  await panel.getByRole('textbox', { name: 'Связать со страницей…' }).fill(title);
  await panel.getByRole('option', { name: title }).click();
  await expect(panel.getByRole('link', { name: title })).toBeVisible();
  const d = await lines(f.admin);
  const pageId = d.docsPages!.find((p) => p.title === title)!.id;
  await expect
    .poll(async () =>
      ((await lines(f.admin)).docsTaskLinks ?? []).some(
        (l) => l.pageId === pageId && l.taskId === f.taskIds[0],
      ),
    )
    .toBe(true);

  await page.getByRole('link', { name: 'Входящие' }).click();
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').getByRole('textbox').fill(word);
  await page.getByRole('option').filter({ hasText: title }).click();
  await expect(page).toHaveURL(new RegExp(`/m/docs/${pageId}`));
});

test('collab: модуль chat выключен — раздел «Чат» скрыт и /m/chat не открывается', async ({
  browser,
}) => {
  const page = await loginAs(browser, 'alice');
  await expect(chatNav(page)).toBeVisible();
  await setModules(admin, ['docs']);
  await expect(chatNav(page)).toHaveCount(0, { timeout: 10_000 });
  await expect(docsNav(page)).toBeVisible();
  await page.goto('/m/chat/');
  await expect(page.getByTestId('chat-page')).toHaveCount(0);
});

test('collab: реплика, открытая до включения модулей, получает их таблицы без очистки', async ({
  browser,
}) => {
  await setModules(admin, []);
  const f = await fixture([uniq('Реплика')]);
  const page: Page = await loginAs(browser, 'alice');
  await expect(chatNav(page)).toHaveCount(0);
  await setModules(admin, MODULES);
  const name = uniq('канал после');
  await channel(f.admin, f, name);
  await expect(chatNav(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('chat-channel').filter({ hasText: name })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId('chat-channel').filter({ hasText: name }).click();
  await expect(page.getByTestId('chat-feed')).toBeVisible();
});

test('collab: холодная загрузка /m/chat/c/<id> открывает канал, а не заглушку «Модуль»', async ({
  browser,
}) => {
  // дефект: маршруты модулей добавляются после загрузки реплики, роутер уже разрешил url в заглушку
  const f = await fixture([uniq('Deep')]);
  const ch = await channel(f.admin, f, uniq('канал'));
  const page = await loginAs(browser, 'alice');
  await page.goto(`/m/chat/c/${ch}`);
  await expect(page.getByTestId('chat-feed')).toBeVisible();
});
