import { expect, test } from '@playwright/test';
import { Client } from '../lib.js';
import { fixture, loginAs, uniq } from './helpers.js';
import { channel, setModules } from './collab-helpers.js';

const need = ['docs', 'chat', 'import'];
const current = async (admin: Client) =>
  ((await admin.bootstrap()).data.settings?.find((x) => x.id === 'enabled_modules')?.value as
    string[] | undefined) ?? [];
let initial: string[] = [];
test.beforeAll(async () => {
  const admin = await Client.login('admin');
  initial = await current(admin);
  await setModules(admin, [...new Set([...initial, ...need])]);
});
test.afterAll(async () => {
  await setModules(await Client.login('admin'), initial);
});
const stub = (p: import('@playwright/test').Page) => p.getByRole('heading', { name: /^Модуль: / });

test('cold import', async ({ browser }) => {
  const page = await loginAs(browser, 'admin');
  await page.goto('/m/import/');
  await expect(page.locator('input[type=file]')).toBeAttached({ timeout: 10_000 });
  await expect(stub(page)).toHaveCount(0);
});
test('cold chat', async ({ browser }) => {
  const page = await loginAs(browser, 'admin');
  await page.goto('/m/chat/');
  await expect(page.getByTestId('chat-page')).toBeVisible();
  await expect(stub(page)).toHaveCount(0);
});
test('cold chat channel', async ({ browser }) => {
  const f = await fixture([uniq('Deep')]);
  const ch = await channel(f.admin, f, uniq('канал'));
  const page = await loginAs(browser, 'alice');
  await page.goto(`/m/chat/c/${ch}`);
  await expect(page.getByTestId('chat-feed')).toBeVisible();
});
test('выключенный модуль показывает «Модуль выключен»', async ({ browser }) => {
  const admin = await Client.login('admin');
  const all = await current(admin);
  await setModules(
    admin,
    all.filter((m) => m !== 'import'),
  );
  try {
    const page = await loginAs(browser, 'admin');
    await page.goto('/m/import/');
    await expect(page.getByText('Модуль выключен')).toBeVisible();
  } finally {
    await setModules(await Client.login('admin'), all);
  }
});
