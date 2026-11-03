import { expect, test, type Page } from '@playwright/test';
import { Client, ranks, uuidv7 } from '../lib.js';
import { fixture, uniq, type Fixture } from './helpers.js';

// PJ-10: «Моя работа» на мобильном не выходит за экран
const VIEWPORT = { width: 390, height: 844 };
const SUBS = ['assigned', 'comments', 'mentions', 'created', 'watched', 'activity', 'summary'];

async function mobile(browser: import('@playwright/test').Browser): Promise<Page> {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    locale: 'ru-RU',
    viewport: VIEWPORT,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Логин').fill('alice');
  await page.getByLabel('Пароль').fill('alice');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return page;
}

/** Document has no scroll on either axis. */
async function noDocScroll(page: Page, what: string) {
  const m = await page.evaluate(() => {
    const d = document.documentElement;
    // on failure: elements whose content overflows (hint for the message)
    const wide = [...document.querySelectorAll('body *')]
      .filter((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 1)
      .map((e) => `${e.tagName}.${String(e.getAttribute('class')).slice(0, 60)}`)
      .slice(0, 6);
    return { wide, sw: d.scrollWidth, cw: d.clientWidth, sh: d.scrollHeight, ch: d.clientHeight };
  });
  expect(m.sw, `${what}: scrollWidth, wider: ${m.wide.join(' | ')}`).toBeLessThanOrEqual(m.cw);
  expect(m.sh, `${what}: scrollHeight`).toBeLessThanOrEqual(m.ch);
}

async function inScreen(page: Page, sel: string, what: string) {
  const b = await page.locator(sel).first().boundingBox();
  expect(b, what).not.toBeNull();
  expect(b!.x, `${what}: x`).toBeGreaterThanOrEqual(0);
  expect(b!.y, `${what}: y`).toBeGreaterThanOrEqual(0);
  expect(b!.x + b!.width, `${what}: right`).toBeLessThanOrEqual(VIEWPORT.width);
  expect(b!.y + b!.height, `${what}: bottom`).toBeLessThanOrEqual(VIEWPORT.height);
}

/** Alice is assigned to a task in the fixture project. */
async function assign(f: Fixture, alice: Client, title: string) {
  const [r] = ranks(1);
  await f.admin.pushOk([
    f.admin.mut('task.create', {
      id: uuidv7(),
      projectId: f.projectId,
      statusId: f.statusIds[0],
      title,
      rank: r,
      assignees: [{ id: uuidv7(), userId: alice.userId }],
    }),
  ]);
}

test('PJ-10: «Моя работа» в мобильном viewport — нет прокрутки документа, панели фильтра в пределах экрана', async ({
  browser,
}) => {
  const alice = await Client.login('alice');
  const f1 = await fixture([]);
  const f2 = await fixture([]);
  // many long titles: the list must scroll inside its own area
  for (let i = 0; i < 25; i++) {
    await assign(i % 2 ? f1 : f2, alice, uniq(`Длинное название задачи для проверки вёрстки ${i}`));
  }
  const page = await mobile(browser);
  await page.goto('/w/work');
  await expect(page.getByTestId('my-work')).toBeVisible();

  for (const w of SUBS) {
    await page.goto(`/w/work?w=${w}`);
    await expect(page.getByTestId('my-work')).toBeVisible();
    if (w === 'assigned' || w === 'created' || w === 'watched') {
      const tabs = page.getByTestId('view-tabs').getByRole('tab');
      await expect(tabs.first()).toBeVisible();
      const n = await tabs.count();
      for (let i = 0; i < n; i++) {
        await tabs.nth(i).click();
        await noDocScroll(page, `${w} вид ${i}`);
        if (w === 'assigned') {
          await page.getByTestId('view-toggle').click();
          await inScreen(page, '[data-testid=sheet]', `${w} вид ${i} опции`);
          await noDocScroll(page, `${w} вид ${i} опции`);
          await page.keyboard.press('Escape');
        }
      }
      if (w === 'assigned') {
        await page.getByTestId('project-filter').click();
        await inScreen(page, '[data-testid=sheet]', 'фильтр проектов');
        await noDocScroll(page, 'фильтр проектов');
        await page.keyboard.press('Escape');
      }
    } else {
      await noDocScroll(page, w);
    }
  }
});
