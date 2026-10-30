import http from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';
import { MODULES, setModules } from './collab-helpers.js';
import type { Client } from '../lib.js';

export const P4_MODULES = [...MODULES, 'timeline', 'recurring', 'templates', 'goals', 'plugins'];

/** Enables p4 modules (email — separately: requires SMTP). */
export const enableP4 = (admin: Client) => setModules(admin, P4_MODULES);

/** Selection in Reka Select by label: option by focus and Enter. */
export async function pickIn(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label }).click();
  const opt = page.getByRole('option', { name: option, exact: true });
  await opt.focus();
  await opt.press('Enter');
}

/** SPA transition by url: module routes and tabs appear after the replica loads (a cold goto — a stub). */
export async function spa(page: Page, url: string, ready: Locator): Promise<void> {
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(async () => {
    await page.evaluate((u) => {
      history.pushState({}, '', u);
      dispatchEvent(new PopStateEvent('popstate'));
    }, url);
    await ready.waitFor({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
}

/** Static files of examples/plugin-hello on 127.0.0.1 (host ≠ app localhost). */
export async function pluginServer() {
  const html = readFileSync(
    fileURLToPath(new URL('../../examples/plugin-hello/index.html', import.meta.url)),
  );
  const server = http.createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
