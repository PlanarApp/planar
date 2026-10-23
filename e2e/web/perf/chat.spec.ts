import { test, type Page } from '@playwright/test';
import { BASE, Client, uuidv7 } from '../../lib';

// Замер чата (CL-5): запускается только с CHAT_PERF=1 на стеке с включённым модулем chat.
test.skip(!process.env.CHAT_PERF, 'CHAT_PERF=1');

const N = Number(process.env.CHAT_MSGS ?? 10_000);
const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
const p95 = (a: number[]) => sorted(a)[Math.min(a.length - 1, Math.ceil(a.length * 0.95) - 1)]!;
const out = (k: string, v: number) => process.stdout.write(`${k}=${v.toFixed(1)}\n`);
const doc = (t: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
});

async function open(page: Page, url: string) {
  await page.goto('/');
  await page.getByRole('heading', { name: 'Чат', level: 2 }).waitFor();
  // роуты модуля появляются после загрузки реплики; прямой goto даёт заглушку (дефект, отчёт CL-5)
  await page.evaluate((u) => {
    history.pushState({}, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, url);
  await page.getByTestId('chat-composer').waitFor();
}

test('чат: 10 000 сообщений — отправка и прокрутка', async ({ browser }) => {
  test.setTimeout(1_800_000); // посев 10 000 сообщений мутациями ≈ 10–15 мин (стоимость растёт с длиной канала);
  const admin = await Client.login('admin');
  const spaceId = ((await admin.bootstrap()).data.spaces as { id: string }[])[0]!.id;
  const ch = uuidv7();
  await admin.pushOk([admin.mut('chat.channel.create', { id: ch, spaceId, name: `perf ${ch}` })]);
  const t0 = Date.now();
  for (let i = 0; i < N; i += 100) {
    await admin.pushOk(
      Array.from({ length: Math.min(100, N - i) }, (_, j) =>
        admin.mut('chat.message.send', {
          id: uuidv7(),
          channelId: ch,
          body: doc(`сообщение ${i + j} ${'слово '.repeat((i + j) % 12)}`),
          readId: uuidv7(),
        }),
      ),
    );
  }
  out('seed_s', (Date.now() - t0) / 1000);
  out('messages', N);

  const ctx = await browser.newContext({
    baseURL: BASE,
    locale: 'ru-RU',
    storageState: await admin.ctx.storageState(),
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  const url = `/m/chat/c/${ch}`;
  await open(page, url);

  // отправка: Enter → строка в DOM
  const box = page.getByTestId('chat-composer').getByRole('textbox');
  const sends: number[] = [];
  for (let i = 0; i < 20; i++) {
    const text = `perf-send-${i}-${Date.now()}`;
    await box.click();
    await box.pressSequentially(text);
    await page.evaluate((t) => {
      const w = window as unknown as { __done: Promise<number> };
      w.__done = new Promise<number>((res) => {
        let t0 = 0;
        document.addEventListener('keydown', (e) => e.key === 'Enter' && (t0 = performance.now()), {
          capture: true,
          once: true,
        });
        const mo = new MutationObserver(() => {
          if (t0 && document.querySelector('[data-testid=chat-feed]')?.textContent?.includes(t)) {
            mo.disconnect();
            res(performance.now() - t0);
          }
        });
        mo.observe(document, { childList: true, subtree: true, characterData: true });
      });
    }, text);
    await page.keyboard.press('Enter');
    sends.push(
      await page.evaluate(() => (window as unknown as { __done: Promise<number> }).__done),
    );
    await page.waitForTimeout(300);
  }
  out('send_ms_p95', p95(sends));
  out('send_ms_max', Math.max(...sends));

  // прокрутка вверх на всю загруженную историю: длинные задачи (>50 мс) и кадры
  await open(page, url);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean; __long: number[] };
    w.__frames = [];
    w.__long = [];
    w.__stop = false;
    new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => w.__long.push(e.duration)),
    ).observe({
      type: 'longtask',
      buffered: false,
    });
    let last = 0;
    const f = (t: number) => {
      if (last) w.__frames.push(t - last);
      last = t;
      if (!w.__stop) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  const box2 = (await page.getByTestId('chat-feed').boundingBox())!;
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 3);
  const scroller = page.locator('[data-testid=chat-feed] > div.overflow-y-auto');
  let steps = 0;
  const end = Date.now() + 120_000;
  while (Date.now() < end) {
    await page.mouse.wheel(0, -1500);
    await page.waitForTimeout(16);
    steps++;
    if (steps % 50 === 0 && (await scroller.evaluate((e) => e.scrollTop)) < 5) {
      await page.waitForTimeout(500); // дать подгрузиться следующей странице
      if ((await scroller.evaluate((e) => e.scrollTop)) < 5 && steps > 200) break;
    }
  }
  const r = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean; __long: number[] };
    w.__stop = true;
    return { frames: w.__frames, long: w.__long };
  });
  out('scroll_steps', steps);
  out('scroll_frame_ms_p95', p95(r.frames));
  out('scroll_long_frames', r.frames.filter((f) => f > 50).length);
  out('scroll_longtasks_50ms', r.long.filter((d) => d > 50).length);
  out('scroll_frames_n', r.frames.length);
  out('scroll_total_height_px', await scroller.evaluate((e) => e.scrollHeight));
  await ctx.close();
});
