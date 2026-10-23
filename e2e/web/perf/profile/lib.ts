import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BASE, Client } from '../../../lib';

export const ROW = '[role=row][data-task]';
const here = fileURLToPath(new URL('.', import.meta.url));
export const RAW = process.env.RAW_DIR ?? `${here}../../../../build/wb17-raw/${process.env.LABEL ?? "base"}`;
export const RES = `${here}results/${process.env.LABEL ?? 'base'}`;
mkdirSync(RAW, { recursive: true });
mkdirSync(RES, { recursive: true });
export const save = (name: string, v: unknown) =>
  writeFileSync(`${RES}/${name}.json`, JSON.stringify(v, null, 1));

const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
export const median = (a: number[]) => sorted(a)[Math.floor((a.length - 1) / 2)]!;
export const p95 = (a: number[]) => sorted(a)[Math.min(a.length - 1, Math.ceil(a.length * 0.95) - 1)]!;

/** Инструментация страницы: транзакции IndexedDB, fetch, WebSocket, long-animation-frame, marks. Время — performance.now(). */
export function instrument(): void {
  const w = window as any;
  const ev: any[] = (w.__ev = []);
  const T = () => performance.now();
  const dbp = IDBDatabase.prototype;
  const otx = dbp.transaction;
  dbp.transaction = function (this: IDBDatabase, stores: any, mode?: any, o?: any) {
    const tx = otx.call(this, stores, mode, o);
    const e: any = {
      k: 'tx',
      db: this.name,
      mode: mode ?? 'readonly',
      n: [].concat(stores).length,
      s: [].concat(stores).slice(0, 3).join(','),
      t0: T(),
      ops: {},
    };
    (tx as any).__e = e;
    ev.push(e);
    tx.addEventListener('complete', () => (e.t1 = T()));
    tx.addEventListener('abort', () => ((e.t1 = T()), (e.abort = 1)));
    return tx;
  } as any;
  const wrap = (proto: any, names: string[], tx: (o: any) => any) => {
    for (const m of names) {
      const o = proto[m];
      if (!o) continue;
      proto[m] = function (this: any, ...a: any[]) {
        const e = tx(this)?.__e;
        if (e) {
          e.ops[m] = (e.ops[m] ?? 0) + 1;
          if (m === 'put' || m === 'add') e.bytes = (e.bytes ?? 0);
        }
        return o.apply(this, a);
      };
    }
  };
  const names = ['put', 'add', 'get', 'getAll', 'getAllKeys', 'openCursor', 'openKeyCursor', 'delete', 'clear', 'count'];
  wrap(IDBObjectStore.prototype, names, (s) => s.transaction);
  wrap(IDBIndex.prototype, names, (i) => i.objectStore.transaction);
  const of = window.fetch;
  window.fetch = async function (...a: any[]) {
    const url = String(a[0] instanceof Request ? a[0].url : a[0]);
    const e: any = { k: 'fetch', url: url.replace(location.origin, ''), t0: T(), m: a[1]?.method ?? 'GET' };
    ev.push(e);
    const r = await (of as any).apply(this, a);
    e.tH = T();
    const oj = r.json.bind(r);
    r.json = async () => {
      e.tJ0 = T();
      const v = await oj();
      e.t1 = T();
      return v;
    };
    return r;
  } as any;
  const OW = window.WebSocket;
  window.WebSocket = class extends OW {
    constructor(u: any, p?: any) {
      super(u, p);
      this.addEventListener('message', (m) => ev.push({ k: 'ws', t: T(), d: String(m.data).slice(0, 60) }));
      this.addEventListener('open', () => ev.push({ k: 'wsopen', t: T() }));
    }
  } as any;
  try {
    new PerformanceObserver((l) => {
      for (const x of l.getEntries() as any[])
        ev.push({
          k: 'loaf',
          t0: x.startTime,
          dur: x.duration,
          block: x.blockingDuration,
          rs: x.renderStart,
          sl: x.styleAndLayoutStart,
          sc: x.scripts.map((s: any) => [s.invoker, s.sourceFunctionName, Math.round(s.duration * 10) / 10, s.sourceURL.split('/').pop(), Math.round(s.startTime)]),
        });
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch {}
  w.__first = undefined;
  new MutationObserver((_, o) => {
    if (document.querySelector('[role=row][data-task]')) {
      w.__first = T();
      ev.push({ k: 'firstRow', t: w.__first });
      o.disconnect();
    }
  }).observe(document, { childList: true, subtree: true });
}

export async function ctxFor(browser: Browser, c: Client, inst = true): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE, storageState: await c.ctx.storageState() });
  if (inst) await context.addInitScript(instrument);
  return context;
}

export async function firstRow(page: Page): Promise<number> {
  await page.waitForFunction(() => (window as any).__first !== undefined);
  return page.evaluate(() => (window as any).__first as number);
}

export const events = (page: Page): Promise<any[]> => page.evaluate(() => (window as any).__ev);

export class Prof {
  s!: CDPSession;
  constructor(public page: Page) {}
  async start() {
    this.s = await this.page.context().newCDPSession(this.page);
    await this.s.send('Profiler.enable');
    await this.s.send('Profiler.setSamplingInterval', { interval: 1000 });
    await this.s.send('Profiler.start');
  }
  async stop(name: string) {
    const { profile } = await this.s.send('Profiler.stop');
    writeFileSync(`${RAW}/${name}.cpuprofile`, JSON.stringify(profile));
  }
}

/** Проекты: большой (по числу задач) и второй. */
export async function projects(admin: Client) {
  const { data } = await admin.bootstrap();
  const ps = data.projects as { id: string; key: string }[];
  const ts = data.tasks as { projectId: string }[];
  const count = (id: string) => ts.filter((t) => t.projectId === id).length;
  const [big, other] = [...ps].sort((a, b) => count(b.id) - count(a.id));
  return { big: big!, other: other!, counts: { big: count(big!.id), other: count(other!.id), total: ts.length } };
}

/** Редактирование названия через UI; возвращает [t0 (Enter), t1 (смена текста)] в performance.now(). */
export async function editTitle(page: Page, key: string, title: string): Promise<[number, number]> {
  const row = page.locator(`[data-task="${key}"]`);
  await row.locator('span.truncate.block').dblclick();
  await row.getByRole('textbox').fill(title);
  // слушатели ставим и дожидаемся их установки до Enter: при правке < 50 мс иначе Enter обгоняет evaluate (гонка в measure.spec WB-15)
  await page.evaluate(
    ([k, t]) => {
      (window as any).__done = new Promise<[number, number]>((res) => {
        let t0 = 0;
        document.addEventListener('keydown', (e) => e.key === 'Enter' && ((t0 = performance.now()), ((window as any).__ev as any[]).push({ k: 'enter', t: t0 })), { capture: true, once: true });
        const mo = new MutationObserver(() => {
          const el = document.querySelector(`[data-task="${k}"] span.truncate.block`);
          if (t0 && el?.textContent === t) {
            const t1 = performance.now();
            ((window as any).__ev as any[]).push({ k: 'dom', t: t1 });
            mo.disconnect();
            res([t0, t1]);
          }
        });
        mo.observe(document, { childList: true, subtree: true, characterData: true });
      });
    },
    [key, title] as const,
  );
  await page.keyboard.press('Enter');
  const done = page.evaluate(() => (window as any).__done as Promise<[number, number]>);
  const stalled = new Promise<never>((_, rej) =>
    setTimeout(async () => {
      const d = await page
        .evaluate(
          ([k, t]) =>
            new Promise((res) => {
              const rq = indexedDB.open('planar');
              rq.onsuccess = () => {
                const db = rq.result;
                const g = db.transaction(['tasks', '_queue'], 'readonly');
                const all = g.objectStore('tasks').getAll();
                const q = g.objectStore('_queue').count();
                g.oncomplete = () =>
                  res({
                    inDb: (all.result as any[]).filter((x) => x.title === t).length,
                    queue: q.result,
                    dom: document.querySelector(`[data-task="${k}"] span.truncate.block`)?.textContent,
                    editing: !!document.querySelector(`[data-task="${k}"] input[type=text], [data-task="${k}"] input:not([type])`),
                  });
              };
            }),
          [key, title] as const,
        )
        .catch((e) => String(e));
      rej(new Error('stalled ' + JSON.stringify(d) + ' want=' + title));
    }, 8000),
  );
  return Promise.race([done, stalled]);
}
