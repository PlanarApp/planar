import { expect, test, type Page } from '@playwright/test';
import { Client } from '../lib.js';
import { fixture, loginAs, uniq } from './helpers.js';

// PJ-4: personal node view on the server
const labels = (page: Page) => page.locator('[data-field=labels]');

async function openOptions(page: Page) {
  await page.getByTestId('view-toggle').click();
  await expect(labels(page)).toBeVisible();
}
async function closeOptions(page: Page) {
  await page.keyboard.press('Escape');
  await expect(labels(page)).toHaveCount(0);
}

test('PJ-4: два пользователя видят каждый свой вид; перезагрузка сохраняет; «Сохранить для всех» и «Сбросить»', async ({
  browser,
}) => {
  const f = await fixture([uniq('Вид')]);
  const node = `p:${f.projectId}`;
  const url = `/p/${f.projectId}/list`;
  const [alice, bob] = await Promise.all([Client.login('alice'), Client.login('bob')]);
  const mine = async (c: Client) =>
    ((await c.bootstrap()).data.savedViews ?? []).filter(
      (v) => v.node === node && v.layout === 'list',
    );

  const pa = await loginAs(browser, 'alice');
  const pb = await loginAs(browser, 'bob');
  await pa.goto(url);
  await pb.goto(url);

  // alice hides the "Labels" field: saved at once, no Save button
  await openOptions(pa);
  await expect(labels(pa)).toBeChecked();
  await labels(pa).uncheck();
  await closeOptions(pa);
  await expect.poll(async () => (await mine(alice)).length).toBe(1);
  expect((await mine(alice))[0]).toMatchObject({ userId: alice.userId });
  await expect(pa.getByTestId('saved-save')).toHaveCount(0);

  // bob still has the default; the reload keeps alice's view
  await openOptions(pb);
  await expect(labels(pb)).toBeChecked();
  await closeOptions(pb);
  await pa.reload();
  await openOptions(pa);
  await expect(labels(pa)).not.toBeChecked();
  await closeOptions(pa);

  // alice makes it the shared default: her personal row is replaced by the shared one
  await pa.getByTestId('node-share').click();
  await expect.poll(async () => (await mine(alice)).map((v) => v.userId)).toEqual([null]);
  await expect(pa.getByTestId('node-reset')).toHaveCount(0);

  // bob gets the shared default after a reload, changes it for himself and resets back
  await pb.reload();
  await openOptions(pb);
  await expect(labels(pb)).not.toBeChecked();
  await labels(pb).check();
  await closeOptions(pb);
  await expect.poll(async () => (await mine(bob)).length).toBe(2); // shared + his own
  expect(await mine(alice)).toHaveLength(1); // his row is not visible to alice
  await pb.getByTestId('node-reset').click();
  await expect.poll(async () => (await mine(bob)).length).toBe(1);
  await openOptions(pb);
  await expect(labels(pb)).not.toBeChecked();
});
