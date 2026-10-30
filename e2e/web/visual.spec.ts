import { expect, test, type Browser } from '@playwright/test';
import { BASE } from '../lib.js';
import { NOW, buildData, shiftTime, type Data } from './visual-helpers.js';

// Screenshots: 14 screens × 2 widths × 2 themes. Baselines — in visual.spec.ts-snapshots (creating: --update-snapshots).
const SCREENS: [name: string, url: (d: Data) => string, ready: string | RegExp][] = [
  ['login', () => '/login', 'Войти'],
  ['my', () => '/my', 'Подготовить макеты экрана входа'],
  ['work', () => '/w/work', 'Назначено мне'],
  ['activity', () => '/w/work?w=activity', 'Подготовить макеты экрана входа'],
  ['list', (d) => `/p/${d.projectId}`, 'Подготовить макеты экрана входа'],
  ['board', (d) => `/p/${d.projectId}/board`, 'Подготовить макеты экрана входа'],
  ['task', (d) => `/t/${d.taskKey}`, 'Макеты готовы к ревью.'],
  ['settings-projects', (d) => `/s/${d.spaceId}/settings?s=projects`, 'Проекты пространства'],
  ['space-board', (d) => `/s/${d.spaceId}/board`, 'Подготовить макеты экрана входа'],
  ['profile', () => '/profile', 'Новый пароль'],
  ['chat', (d) => `/m/chat/c/${d.chatId}`, 'Нашла обрезку заголовка на узком экране.'],
  ['docs', (d) => `/m/docs/${d.docId}`, 'Плотность и отступы'],
  ['time-week', () => '/w/reports?r=time:week', 'Время'],
  ['dev-ui', () => '/dev/ui', 'C-ui v4'],
];
const WIDTHS = [
  [1440, 900],
  [390, 844],
] as const;

test.describe.configure({ retries: 2 }); // a rare empty screen on the first load of the replica (see report)

let data: Data;
let state: Awaited<ReturnType<Data['alice']['ctx']['storageState']>>;
test.beforeAll(async () => {
  data = await buildData();
  state = await data.alice.ctx.storageState();
});

async function open(browser: Browser, w: number, h: number, theme: string, anon: boolean) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    locale: 'ru-RU',
    timezoneId: 'UTC',
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    ...(anon ? {} : { storageState: state }),
  });
  await ctx.addInitScript((t) => localStorage.setItem('planar.theme', t), theme);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  await shiftTime(page, data.offset);
  return { ctx, page };
}

for (const [name, url, ready] of SCREENS)
  for (const [w, h] of WIDTHS)
    for (const theme of ['light', 'dark'])
      test(`${name}-${w}-${theme}`, async ({ browser }) => {
        const { ctx, page } = await open(browser, w, h, theme, name === 'login');
        const to = url(data);
        const target = page.getByText(ready).first();
        if (to.startsWith('/m/')) {
          // module routes are added after the replica loads: a cold goto sometimes gives the «Module» stub — we navigate as SPA until it opens
          await page.goto('/my');
          await expect(async () => {
            await page.evaluate(
              (urls) => {
                for (const u of urls) {
                  history.pushState({}, '', u);
                  dispatchEvent(new PopStateEvent('popstate'));
                }
              },
              ['/my', to],
            );
            await expect(target).toBeVisible({ timeout: 2000 });
          }).toPass({ timeout: 20_000 });
        } else {
          await page.goto(to);
          await expect(target).toBeVisible();
        }
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500); // replica catch-up and re-rendering of lists
        await expect(page).toHaveScreenshot(`${name}-${w}-${theme}.png`, {
          animations: 'disabled',
          caret: 'hide',
          fullPage: false,
          maxDiffPixelRatio: 0.01,
        });
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await ctx.close();
      });
