// PLNRAPP-891: the project's GitHub repositories panel — all repositories of the connection, the search, bind /
// unbind; no connection — a hint; a refused token — the connection error instead of the list
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { TooltipProvider } from 'reka-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../i18n';
import Repos from '../../../../../../modules/github/web/GithubRepos.vue';

const P = '11111111-1111-4111-8111-111111111111';
const ALL = Array.from({ length: 150 }, (_, i) => ({
  repoId: i + 1,
  fullName: `acme/repo-${String(i + 1).padStart(3, '0')}`,
  defaultBranch: 'main',
  private: false,
}));
type Bound = {
  id: string;
  projectId: string;
  connectionId: string;
  repoId: number;
  fullName: string;
  defaultBranch: string;
};
let calls: { method: string; path: string; body: unknown }[];
let bound: Bound[];
let available: () => { status: number; body: unknown };
const res = (status: number, body?: unknown) => ({
  status,
  ok: status < 400,
  json: async () => body ?? {},
});

beforeEach(() => {
  calls = [];
  bound = [];
  available = () => ({ status: 200, body: { connected: true, repos: ALL } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, o: { method: string; body?: string }) => {
      const body = o.body && JSON.parse(o.body);
      calls.push({ method: o.method, path, body });
      if (path.endsWith('/available')) {
        const r = available();
        return res(r.status, r.body);
      }
      if (o.method === 'POST') {
        const o2 = ALL.find((x) => x.fullName === body.fullName)!;
        // the server upserts: the same repository again — the same row
        if (!bound.some((b) => b.repoId === o2.repoId))
          bound.push({
            id: `b${o2.repoId}`,
            projectId: P,
            connectionId: 'c1',
            repoId: o2.repoId,
            fullName: o2.fullName,
            defaultBranch: o2.defaultBranch,
          });
        return res(201, { repo: bound.at(-1) });
      }
      if (o.method === 'DELETE') {
        const id = path.split('/').pop();
        bound = bound.filter((b) => b.id !== id);
        return res(204);
      }
      return res(200, { repos: [...bound] });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const mountIt = async () => {
  const Host = defineComponent({
    render: () => h(TooltipProvider, () => h(Repos, { projectId: P })),
  });
  const w = mount(Host, { global: { plugins: [i18n] }, attachTo: document.body });
  await flushPromises();
  return w;
};
const options = (w: Awaited<ReturnType<typeof mountIt>>) =>
  w.findAll('[data-testid=gh-repo-options] option').map((o) => o.text());

describe('github: репозитории проекта', () => {
  it('показывает все 150 репозиториев подключения', async () => {
    const w = await mountIt();
    expect(calls.map((c) => c.path).sort()).toEqual([
      `/api/github/projects/${P}/available`,
      `/api/github/projects/${P}/repos`,
    ]);
    expect(options(w)).toHaveLength(150);
    expect(w.find('[data-testid=gh-no-repos]').exists()).toBe(true);
  });

  it('поиск по части имени оставляет только совпадающие', async () => {
    const w = await mountIt();
    await w.get('[data-testid=gh-repo-search]').setValue('REPO-12');
    expect(options(w)).toEqual(Array.from({ length: 10 }, (_, i) => `acme/repo-12${i}`));
    await w.get('[data-testid=gh-repo-search]').setValue('nothing');
    expect(options(w)).toEqual([]);
    expect(w.find('[data-testid=gh-repo-empty]').exists()).toBe(true);
  });

  it('«Привязать» добавляет в привязанные, «Отвязать» убирает', async () => {
    const w = await mountIt();
    expect(w.get('[data-testid=gh-bind]').attributes('disabled')).toBeDefined();
    await w.get('[data-testid=gh-repo-options]').setValue('acme/repo-007');
    await w.get('[data-testid=gh-bind-form]').trigger('submit');
    await flushPromises();
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: `/api/github/projects/${P}/repos`,
      body: { fullName: 'acme/repo-007' },
    });
    expect(w.findAll('[data-testid=gh-repo-name]').map((x) => x.text())).toEqual(['acme/repo-007']);
    // the bound one is marked in the choice and cannot be picked again
    const opt = w.findAll('[data-testid=gh-repo-options] option')[6]!;
    expect(opt.attributes('disabled')).toBeDefined();

    await w.get('[data-testid=gh-unbind]').trigger('click');
    await flushPromises();
    expect(calls.find((c) => c.method === 'DELETE')).toMatchObject({
      path: '/api/github/repos/b7',
    });
    expect(w.find('[data-testid=gh-repo]').exists()).toBe(false);
  });

  it('без подключения — подсказка подключить GitHub, а не ошибка', async () => {
    available = () => ({ status: 200, body: { connected: false, repos: [] } });
    const w = await mountIt();
    expect(w.find('[data-testid=gh-repos-hint]').exists()).toBe(true);
    expect(w.find('[data-testid=gh-bind-form]').exists()).toBe(false);
    expect(w.find('[role=alert]').exists()).toBe(false);
  });

  it('токен отклонён — сообщение об ошибке подключения, списка нет', async () => {
    available = () => ({
      status: 502,
      body: { code: 'unavailable', message: 'Токен GitHub недействителен или не имеет доступа' },
    });
    const w = await mountIt();
    expect(w.get('[data-testid=gh-list-error]').text()).toBe(
      'Токен GitHub недействителен или не имеет доступа',
    );
    expect(w.find('[data-testid=gh-bind-form]').exists()).toBe(false);
  });
});
