import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

// PJ-7: the "Update" banner applies the new service worker. Self-contained: serves apps/web/dist
// (needs `pnpm --filter @planar/web build`) and swaps /sw.js for a byte-different one — "a new version".
const dist = fileURLToPath(new URL('../../apps/web/dist', import.meta.url));
const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
let server: Server;
let base = '';
let version = 1;

test.beforeAll(async () => {
  test.skip(!existsSync(join(dist, 'sw.js')), 'apps/web/dist not built');
  server = createServer((req, res) => {
    const path = normalize(new URL(req.url ?? '/', 'http://x').pathname);
    let file = join(dist, path);
    if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile())
      file = join(dist, 'index.html');
    let body: Buffer | string = readFileSync(file);
    if (path === '/sw.js') body = `${body}\n// v${version}\n`;
    res.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => server?.close());

async function controlled(page: Page) {
  version = 1;
  await page.goto(`${base}/login`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload(); // now controlled by SW v1
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  version = 2;
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
}

async function applyAndExpectReload(page: Page) {
  const banner = page.getByTestId('pwa-update');
  await expect(banner.getByRole('button')).toBeVisible();
  const navigated = page.waitForEvent('framenavigated');
  await banner.getByRole('button').click();
  await expect(banner.getByRole('progressbar')).toBeVisible(); // "Applying…" while waiting for the reload
  await navigated; // the click reloaded the page into the new version
  await expect(page.getByTestId('pwa-update')).toHaveCount(0);
  // the new version is installed and active, nothing waits any more
  await expect
    .poll(() =>
      page.evaluate(() =>
        navigator.serviceWorker
          .getRegistration()
          .then((r) => `${r?.active?.state}/${r?.waiting?.state}/${r?.installing?.state}`),
      ),
    )
    .toBe('activated/undefined/undefined');
}

test('PJ-7: «Обновить» применяет новую версию SW и перезагружает страницу', async ({ page }) => {
  await controlled(page);
  await applyAndExpectReload(page);
});

test('PJ-7: обновление уже ждёт при загрузке страницы — «Обновить» всё равно применяет', async ({
  page,
}) => {
  await controlled(page);
  await expect(page.getByTestId('pwa-update').getByRole('button')).toBeVisible();
  await page.reload(); // the waiting worker predates this page; the browser then ignores skipWaiting
  await applyAndExpectReload(page);
});
