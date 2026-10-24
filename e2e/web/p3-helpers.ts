import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, type Locator, type Page } from '@playwright/test';
import { MODULES, setModules } from './collab-helpers.js';
import type { Client } from '../lib.js';

export const P3_MODULES = [...MODULES, 'time', 'timeline', 'workload', 'forms', 'gitlab'];

/**
 * Включает модули p3 (time — для режима «оценки» нагрузки). dashboards — только по `withDashboards`:
 * пока маршрут '/m/dashboards' вне '/m/dashboards/' (registerModules), его включение ломает регистрацию
 * всей пачки модулей на клиенте.
 */
export const enableP3 = (admin: Client, withDashboards = false) =>
  setModules(admin, withDashboards ? [...P3_MODULES, 'dashboards'] : P3_MODULES);

/**
 * SPA-переход по url модуля: маршруты модуля добавляются после загрузки реплики, а холодный goto
 * показывает заглушку (см. collab.spec) — повторяем pushState, пока не появится `ready`.
 */
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

/** Случайный slug формы: ^[a-z0-9]{16}$. */
export const slug16 = () =>
  Array.from(
    { length: 16 },
    () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)],
  ).join('');

export interface FakeMr {
  iid: number;
  title: string;
  updatedAt: string;
}

/** Фейковый GitLab REST v4 в процессе теста (api в docker ходит на host.docker.internal). */
export async function fakeGitlab(token: string, mrs: FakeMr[]) {
  const seen = { tokens: [] as string[], paths: [] as string[] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    seen.paths.push(url.pathname);
    seen.tokens.push(String(req.headers['private-token'] ?? ''));
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers['private-token'] !== token) return json(401, { message: '401 Unauthorized' });
    if (/^\/api\/v4\/projects\/[^/]+$/.test(url.pathname))
      return json(200, { id: 4242, path_with_namespace: 'grp/proj' });
    if (url.pathname === '/api/v4/projects/4242/merge_requests')
      return json(
        200,
        mrs.map((m) => ({
          iid: m.iid,
          title: m.title,
          description: '',
          source_branch: 'feature/x',
          state: 'opened',
          web_url: `https://gitlab.example/grp/proj/-/merge_requests/${m.iid}`,
          updated_at: m.updatedAt,
          author: { name: 'Dev' },
        })),
      );
    json(404, { message: '404 Not Found' });
  });
  await new Promise<void>((r) => server.listen(0, '0.0.0.0', r));
  const port = (server.address() as AddressInfo).port;
  return {
    seen,
    url: `http://host.docker.internal:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
