import { expect, test } from '@playwright/test';
import { ranks, uuidv7 } from '../lib.js';
import { fixture, loginAs } from './helpers.js';

// PLNRAPP-114: сохранённые виды упорядочиваются перетаскиванием вкладок
test('PLNRAPP-114: перетаскивание вкладки сохранённого вида меняет порядок', async ({
  browser,
}) => {
  const f = await fixture([]);
  const names = ['Вид-114 A', 'Вид-114 B', 'Вид-114 C'];
  const rk = ranks(names.length);
  const ids = names.map(() => uuidv7());
  await f.admin.pushOk(
    names.map((name, i) =>
      f.admin.mut('view.create', {
        id: ids[i],
        spaceId: f.spaceId,
        personal: true,
        name,
        layout: 'list',
        filter: { op: 'and', rules: [] },
        config: {},
        rank: rk[i],
      }),
    ),
  );
  const page = await loginAs(browser, 'admin');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/p/${f.projectId}/list`);
  const tabs = page.getByTestId('saved-tabs').getByRole('tab');
  const order = () => tabs.allInnerTexts();
  await expect.poll(order).toEqual(names);

  // C — между A и B
  const from = (await tabs.nth(2).boundingBox())!;
  const to = (await tabs.nth(1).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 10 });
  const moved = [names[0], names[2], names[1]];
  await expect.poll(order).toEqual(moved);
  await page.mouse.up();
  await expect.poll(order).toEqual(moved);
  // порядок дошёл до сервера и держится после перезагрузки
  await expect
    .poll(async () => {
      const { data } = await f.admin.bootstrap();
      const views = (
        data as unknown as { savedViews: { id: string; name: string; rank: string }[] }
      ).savedViews;
      return views
        .filter((v) => ids.includes(v.id))
        .sort((a, b) => (a.rank < b.rank ? -1 : 1))
        .map((v) => v.name);
    })
    .toEqual(moved);
  await page.reload();
  await expect.poll(order).toEqual(moved);
  // клик по вкладке по-прежнему открывает вид
  await tabs.nth(2).click();
  await expect(page).toHaveURL(new RegExp(`/v/${ids[1]}`));
});
