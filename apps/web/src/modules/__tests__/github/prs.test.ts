// PLNRAPP-892: PRs and commits of a bound GitHub repository on the task — the key parser, GitHub's answer → rows,
// the sync on a mocked GitHub API (links, statuses, no duplicates on a repeated sync) and the task's tab
import { flushPromises, mount } from '@vue/test-utils';
import { TooltipProvider } from 'reka-ui';
import { defineComponent, h } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../../modules/github/web/data', async () => {
  const { ref } = await import('vue');
  const state = { prs: ref<unknown[]>([]), commits: ref<unknown[]>([]) };
  return {
    __state: state,
    tr: (k: string) => k,
    usePrs: () => state.prs,
    useCommits: () => state.commits,
    prsOf: async () => state.prs.value,
    commitsOf: async () => state.commits.value,
  };
});

import * as data from '../../../../../../modules/github/web/data';
import { web } from '../../../../../../modules/github/web';
import Panel from '../../../../../../modules/github/web/GithubPanel.vue';
import { firstLine, mutators, taskKeys } from '../../../../../../modules/github/shared/index';
import { commitOf, prOf, rowId, syncBinding } from '../../../../../../modules/github/api/sync';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const st = (data as unknown as { __state: Record<string, { value: any }> }).__state;

describe('github: ключи задач', () => {
  it('в ветке, заголовке и сообщении, без учёта регистра, без повторов', () => {
    expect(taskKeys('feature/PLNRAPP-892-x')).toEqual([['PLNRAPP', 892]]);
    expect(taskKeys('plnrapp-892 fix', 'PLNRAPP-892 again')).toEqual([['PLNRAPP', 892]]);
    expect(taskKeys('PLNRAPP-892 PLNRAPP-893')).toEqual([
      ['PLNRAPP', 892],
      ['PLNRAPP', 893],
    ]);
    expect(taskKeys('no keys here', null, undefined)).toEqual([]);
  });
  it('первая строка сообщения коммита', () => {
    expect(firstLine('PLNRAPP-892 fix\n\nbody line')).toBe('PLNRAPP-892 fix');
    expect(firstLine('one\r\ntwo')).toBe('one');
  });
});

const rawPr = (o: Record<string, unknown> = {}) => ({
  number: 7,
  title: 'PLNRAPP-892 тест',
  state: 'open',
  draft: false,
  merged_at: null,
  html_url: 'https://github.com/acme/app/pull/7',
  updated_at: '2026-11-28T10:00:00Z',
  head: { ref: 'feature/x' },
  user: { login: 'octo' },
  ...o,
});
const SHA = '0123456789abcdef0123456789abcdef01234567';
const rawCommit = (o: Record<string, unknown> = {}) => ({
  sha: SHA,
  html_url: `https://github.com/acme/app/commit/${SHA}`,
  commit: {
    message: 'PLNRAPP-892 fix\n\ndetails',
    author: { name: 'Octo Cat', date: '2026-11-28T09:00:00Z' },
  },
  author: { login: 'octo' },
  ...o,
});

describe('github: ответ GitHub → данные строк', () => {
  it('статус PR: open, draft, merged, closed', () => {
    expect(prOf(rawPr())).toMatchObject({
      number: 7,
      title: 'PLNRAPP-892 тест',
      branch: 'feature/x',
      state: 'open',
      authorLogin: 'octo',
      webUrl: 'https://github.com/acme/app/pull/7',
      prUpdatedAt: '2026-11-28T10:00:00.000Z',
    });
    expect(prOf(rawPr({ draft: true }))?.state).toBe('draft');
    expect(prOf(rawPr({ state: 'closed', merged_at: '2026-11-28T11:00:00Z' }))?.state).toBe(
      'merged',
    );
    expect(prOf(rawPr({ state: 'closed' }))?.state).toBe('closed');
    expect(prOf({ title: 'no number' })).toBeNull();
  });
  it('коммит: sha, сообщение, автор, ссылка, дата', () => {
    expect(commitOf(rawCommit())).toEqual({
      sha: SHA,
      message: 'PLNRAPP-892 fix\n\ndetails',
      authorName: 'Octo Cat',
      webUrl: `https://github.com/acme/app/commit/${SHA}`,
      committedAt: '2026-11-28T09:00:00.000Z',
    });
    expect(commitOf({ sha: 'abc' })).toBeNull();
  });
});

// --- the sync on a mocked GitHub with the module's real mutators over an in-memory store
const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SPACE = '33333333-3333-4333-8333-333333333333';
const T892 = '00000000-0000-4000-8000-000000000892';
const T893 = '00000000-0000-4000-8000-000000000893';
const T900 = '00000000-0000-4000-8000-000000000900';
const tasks: Record<string, { id: string; projectId: string; spaceId: string; number: number }> = {
  [T892]: { id: T892, projectId: PROJECT, spaceId: SPACE, number: 892 },
  [T893]: { id: T893, projectId: PROJECT, spaceId: SPACE, number: 893 },
  // a task of another project with the same number range
  [T900]: { id: T900, projectId: OTHER, spaceId: SPACE, number: 900 },
};
const REPO = { projectId: PROJECT, repoId: 3_000_000_001, fullName: 'acme/app' };
// drizzle's sql`` → text and params (the web project has no drizzle dialect of its own)
type Chunk = { value?: unknown; queryChunks?: Chunk[] } | string | number;
function render(q: Chunk, out = { sql: '', params: [] as unknown[] }) {
  if (q && typeof q === 'object' && Array.isArray(q.queryChunks))
    for (const c of q.queryChunks) render(c, out);
  else if (q && typeof q === 'object' && Array.isArray(q.value)) out.sql += q.value.join('');
  else if (q && typeof q === 'object' && 'value' in q) {
    out.params.push(q.value);
    out.sql += '?';
  } else {
    out.params.push(q);
    out.sql += '?';
  }
  return out;
}
let store: Map<string, Map<string, Record<string, unknown>>>;
let pulls: unknown[];
let commits: unknown[];
let gh: string[];
const table = (e: string) => {
  let t = store.get(e);
  if (!t) store.set(e, (t = new Map()));
  return t;
};
const tx = {
  async get(e: string, id: string) {
    return e === 'tasks' ? tasks[id] : table(e).get(id);
  },
  async put(e: string, row: Record<string, unknown>) {
    table(e).set(row.id as string, structuredClone(row));
  },
  async del(e: string, id: string) {
    table(e).delete(id);
  },
  async scan(e: string) {
    return [...table(e).values()];
  },
};
const rows = (e: string) => [...table(e).values()];
const jobApi = {
  systemUserId: 'sys',
  enqueue: async () => {},
  execute: vi.fn(async (_u: string, muts: { name: string; args: unknown }[]) => {
    for (const m of muts) {
      const def = mutators.find((x) => x.name === m.name)!;
      await def.run(tx as never, def.args.parse(m.args) as never, {
        userId: 'sys',
        now: '2026-11-28T12:00:00.000Z',
        server: true,
      });
    }
  }),
  db: {
    async execute(q: Chunk) {
      const { sql: text, params } = render(q);
      if (text.includes('from projects')) return { rows: [{ key: 'PLNRAPP' }] };
      if (text.includes('from tasks'))
        return {
          rows: Object.values(tasks).filter(
            (t) => t.projectId === params[0] && params.slice(1).includes(t.number),
          ),
        };
      if (text.includes('from github_prs'))
        return {
          rows: rows('githubPrs')
            .filter(
              (r) => r.repoId === params[0] && tasks[r.taskId as string]?.projectId === PROJECT,
            )
            .map((r) => ({ number: r.number })),
        };
      if (text.includes('from github_commits'))
        return { rows: rows('githubCommits').filter((r) => params.includes(r.id)) };
      throw new Error(`unexpected query ${text}`);
    },
  },
};
const sync = () => syncBinding(jobApi as never, 'ghp_token', REPO);

beforeEach(() => {
  store = new Map();
  gh = [];
  pulls = [];
  commits = [];
  jobApi.execute.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      gh.push(input);
      const u = new URL(input);
      const body = u.pathname.endsWith('/pulls') ? pulls : commits;
      return { status: 200, ok: true, json: async () => body };
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const prRows = (taskId: string) => rows('githubPrs').filter((r) => r.taskId === taskId);
const commitRows = (taskId: string) => rows('githubCommits').filter((r) => r.taskId === taskId);

describe('github: синхронизация PR и коммитов', () => {
  it('запросы к GitHub: /pulls?state=all и /commits репозитория с токеном подключения', async () => {
    await sync();
    expect(gh.map((u) => new URL(u).pathname)).toEqual([
      '/repos/acme/app/pulls',
      '/repos/acme/app/commits',
    ]);
    expect(new URL(gh[0]!).searchParams.get('state')).toBe('all');
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe('Bearer ghp_token');
  });

  it('PR с ключом в заголовке — в задаче со статусом open; влит — merged; повтор без дублей', async () => {
    pulls = [rawPr()];
    expect(await sync()).toEqual({ prs: 1, commits: 0 });
    expect(prRows(T892)).toHaveLength(1);
    expect(prRows(T892)[0]).toMatchObject({
      id: rowId('pr', T892, REPO.repoId, 7),
      spaceId: SPACE,
      repoId: REPO.repoId,
      repoFullName: 'acme/app',
      number: 7,
      title: 'PLNRAPP-892 тест',
      state: 'open',
      webUrl: 'https://github.com/acme/app/pull/7',
    });
    pulls = [rawPr({ state: 'closed', merged_at: '2026-11-28T11:00:00Z' })];
    await sync();
    await sync();
    expect(rows('githubPrs')).toHaveLength(1);
    expect(prRows(T892)[0]!.state).toBe('merged');
  });

  it('PR без ключа в заголовке, но из ветки feature/PLNRAPP-892-x — тоже в задаче', async () => {
    pulls = [rawPr({ title: 'Some work', head: { ref: 'feature/PLNRAPP-892-x' } })];
    await sync();
    expect(prRows(T892)).toHaveLength(1);
    expect(prRows(T892)[0]!.branch).toBe('feature/PLNRAPP-892-x');
  });

  it('коммит с ключом: первая строка, автор, ссылка; повтор не создаёт дублей', async () => {
    commits = [rawCommit()];
    expect(await sync()).toEqual({ prs: 0, commits: 1 });
    expect(commitRows(T892)).toHaveLength(1);
    expect(commitRows(T892)[0]).toMatchObject({
      sha: SHA,
      message: 'PLNRAPP-892 fix',
      authorName: 'Octo Cat',
      webUrl: `https://github.com/acme/app/commit/${SHA}`,
    });
    jobApi.execute.mockClear();
    await sync();
    expect(rows('githubCommits')).toHaveLength(1);
    // a commit already linked is not sent again
    expect(jobApi.execute).not.toHaveBeenCalled();
  });

  it('два ключа — в обеих задачах; чужой ключ и несуществующая задача игнорируются', async () => {
    pulls = [rawPr({ title: 'PLNRAPP-892 PLNRAPP-893' })];
    commits = [
      rawCommit({ commit: { ...rawCommit().commit, message: 'PLNRAPP-892 PLNRAPP-893 both' } }),
      rawCommit({
        sha: 'f'.repeat(40),
        commit: { ...rawCommit().commit, message: 'OTHER-1 PLNRAPP-999 PLNRAPP-900' },
      }),
    ];
    await sync();
    expect(prRows(T892)).toHaveLength(1);
    expect(prRows(T893)).toHaveLength(1);
    expect(commitRows(T892)).toHaveLength(1);
    expect(commitRows(T893)).toHaveLength(1);
    // PLNRAPP-900 is a task of another project: not linked through this binding
    expect(rows('githubCommits')).toHaveLength(2);
    expect(prRows(T900)).toHaveLength(0);
  });

  it('ключ убран из заголовка — PR отвязан от задачи', async () => {
    pulls = [rawPr()];
    await sync();
    expect(prRows(T892)).toHaveLength(1);
    pulls = [rawPr({ title: 'renamed', updated_at: '2026-11-28T13:00:00Z' })];
    await sync();
    expect(prRows(T892)).toHaveLength(0);
  });

  it('PR без ключей и без прежних связей — мутаций нет', async () => {
    pulls = [rawPr({ title: 'nothing' })];
    commits = [rawCommit({ commit: { ...rawCommit().commit, message: 'chore' } })];
    expect(await sync()).toEqual({ prs: 0, commits: 0 });
    expect(jobApi.execute).not.toHaveBeenCalled();
  });

  it('отвязка репозитория (github.repo.drop) убирает его PR и коммиты задач проекта', async () => {
    pulls = [rawPr()];
    commits = [rawCommit()];
    await sync();
    await jobApi.execute('sys', [
      { name: 'github.repo.drop', args: { projectId: PROJECT, repoId: REPO.repoId } },
    ]);
    expect(rows('githubPrs')).toHaveLength(0);
    expect(rows('githubCommits')).toHaveLength(0);
  });
});

// --- the task's tab
const pr = (o: Record<string, unknown> = {}) => ({
  id: 'p' + Math.random(),
  taskId: 't',
  repoId: 1,
  repoFullName: 'acme/app',
  number: 7,
  title: 'PLNRAPP-892 тест',
  branch: 'feature/PLNRAPP-892-x',
  state: 'open',
  authorLogin: 'octo',
  webUrl: 'https://github.com/acme/app/pull/7',
  prUpdatedAt: '2026-11-28T10:00:00.000Z',
  ...o,
});
const commit = (o: Record<string, unknown> = {}) => ({
  id: 'c' + Math.random(),
  taskId: 't',
  repoId: 1,
  repoFullName: 'acme/app',
  sha: SHA,
  message: 'PLNRAPP-892 fix',
  authorName: 'Octo Cat',
  webUrl: `https://github.com/acme/app/commit/${SHA}`,
  committedAt: '2026-11-28T09:00:00.000Z',
  ...o,
});
const mountPanel = async () => {
  const w = mount(
    defineComponent({
      setup: () => () => h(TooltipProvider, null, () => h(Panel, { taskId: 't' })),
    }),
  );
  await flushPromises();
  return w;
};

describe('github: вкладка задачи', () => {
  beforeEach(() => {
    st.prs.value = [];
    st.commits.value = [];
  });

  it('манифест: вкладка PR скрыта без связей; счётчик — влитые/все PR, иначе коммиты', async () => {
    const p = web.taskPanels?.[0];
    expect(p?.id).toBe('prs');
    expect(p?.hideEmpty).toBe(true);
    expect(await p!.count!('t')).toBe(0);
    st.commits.value = [commit()];
    expect(await p!.count!('t')).toBe(1);
    st.prs.value = [pr(), pr({ number: 8, state: 'merged' })];
    expect(await p!.count!('t')).toBe('1/2');
  });

  it('PR: номер, заголовок, статус и ссылка на GitHub; коммит: 7 символов sha, первая строка, автор', async () => {
    st.prs.value = [pr(), pr({ number: 5, state: 'merged', prUpdatedAt: '2026-11-01T00:00:00Z' })];
    st.commits.value = [commit()];
    const w = await mountPanel();
    const prs = w.findAll('[data-testid="gh-pr"]');
    expect(prs).toHaveLength(2);
    const link = prs[0]!.find('[data-testid="gh-pr-link"]');
    expect(link.text()).toBe('#7 PLNRAPP-892 тест');
    expect(link.attributes('href')).toBe('https://github.com/acme/app/pull/7');
    expect(prs[0]!.find('[data-testid="gh-pr-state"]').attributes('data-state')).toBe('open');
    expect(prs[1]!.find('[data-testid="gh-pr-state"]').attributes('data-state')).toBe('merged');
    const c = w.find('[data-testid="gh-commit"]');
    expect(c.find('[data-testid="gh-commit-sha"]').text()).toBe('0123456');
    expect(c.find('[data-testid="gh-commit-sha"]').attributes('href')).toBe(
      `https://github.com/acme/app/commit/${SHA}`,
    );
    expect(c.find('[data-testid="gh-commit-message"]').text()).toBe('PLNRAPP-892 fix');
    expect(c.find('[data-testid="gh-commit-author"]').text()).toBe('Octo Cat');
  });

  it('ссылка не http(s) не выводится', async () => {
    st.prs.value = [pr({ webUrl: 'javascript:alert(1)' })];
    const w = await mountPanel();
    expect(w.find('[data-testid="gh-pr-link"]').attributes('href')).toBeUndefined();
  });

  it('«Синхронизировать» — POST /api/github/tasks/:id/sync', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, o: { method: string }) => {
        calls.push(`${o.method} ${path}`);
        return {
          status: 200,
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ prs: 0, commits: 0 }),
          text: async () => '{"prs":0,"commits":0}',
        };
      }),
    );
    st.prs.value = [pr()];
    const w = await mountPanel();
    await w.find('[data-testid="gh-refresh"]').trigger('click');
    await flushPromises();
    expect(calls.some((c) => c.startsWith('POST') && c.includes('/api/github/tasks/t/sync'))).toBe(
      true,
    );
  });
});
