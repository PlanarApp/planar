import { config, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, type PropType } from 'vue';
import { TooltipProvider } from 'reka-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../../modules/gitlab/web/data', async () => {
  const { ref } = await import('vue');
  const state = {
    mrs: ref<unknown[]>([]),
    branches: ref<unknown[]>([]),
    templates: ref<Record<string, string | null>>({}),
    projects: ref<unknown[]>([]),
    statuses: ref<unknown[]>([]),
    merged: ref<Record<string, string | null>>({}),
  };
  return {
    __state: state,
    mutate: vi.fn(async () => {}),
    tr: (k: string) => k,
    useMrs: () => state.mrs,
    useBranches: () => state.branches,
    useBranchTemplates: () => state.templates,
    useProjects: () => state.projects,
    useStatusList: () => state.statuses,
    useMergedStatuses: () => state.merged,
  };
});

import * as data from '../../../../../../modules/gitlab/web/data';
import { web } from '../../../../../../modules/gitlab/web';
import MrPanel from '../../../../../../modules/gitlab/web/MrPanel.vue';
import CardBadges from '../../../../../../modules/gitlab/web/CardBadges.vue';
import Settings from '../../../../../../modules/gitlab/web/GitlabSettings.vue';
import { registerModules } from '../../registry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const st = (data as unknown as { __state: Record<string, { value: any }> }).__state;
const mutate = data.mutate as unknown as ReturnType<typeof vi.fn>;

// PLNRAPP-153: the app's Dialog lives in a portal and needs i18n — a plain stand-in with its slots
const DialogStub = defineComponent({
  props: { open: Boolean, title: String as PropType<string> },
  setup:
    (p, { slots }) =>
    () =>
      p.open ? h('div', { 'data-testid': 'dialog' }, [slots.default?.(), slots.footer?.()]) : null,
});
config.global.stubs = { Dialog: DialogStub };

const mr = (o: Record<string, unknown>) => ({
  id: 'm' + Math.random(),
  taskId: 't',
  gitlabProjectId: 5,
  iid: 7,
  title: 'Fix login',
  sourceBranch: 'mr/PLN-1',
  state: 'opened',
  webUrl: 'https://gl.example/g/p/-/merge_requests/7',
  mrUpdatedAt: '2026-10-20T10:00:00.000Z',
  ...o,
});

const list = {
  connections: [
    {
      id: 'c1',
      baseUrl: 'https://gl.example',
      gitlabProjectId: 5,
      path: 'g/p',
      lastPolledAt: null,
      lastError: 'unauthorized',
    },
  ],
};
let calls: { method: string; path: string; body: unknown }[];
const res = (status: number, body?: unknown) => ({
  status,
  ok: status < 400,
  json: async () => body ?? {},
});

beforeEach(() => {
  calls = [];
  mutate.mockClear();
  st.mrs.value = [];
  st.branches.value = [];
  st.templates.value = {};
  st.projects.value = [{ id: 'p1', spaceId: 's1', name: 'Proj' }];
  st.statuses.value = [
    { id: 'st1', spaceId: 's1', projectId: 'p1', name: 'Todo' },
    { id: 'st2', spaceId: 's1', projectId: 'p1', name: 'Done' },
    { id: 'st3', spaceId: 's1', projectId: 'p2', name: 'Other project' },
    { id: 'st4', spaceId: 's2', projectId: 'p3', name: 'Other' },
  ];
  st.merged.value = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, o: { method: string; body?: string }) => {
      calls.push({ method: o.method, path, body: o.body && JSON.parse(o.body) });
      if (o.method === 'DELETE' || path.endsWith('/poll')) return res(204);
      if (path.endsWith('/repos')) return res(200, { repos: [] });
      return res(200, list);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const mountSettings = async () => {
  const w = mount(Settings, { props: { projectId: 'p1' } });
  await flushPromises();
  return w;
};

describe('pt6b:', () => {
  it('pt6b: манифест — панель задачи и настройки только в проекте и только для админа', () => {
    expect(web.taskPanels?.[0]?.id).toBe('mrs');
    expect(web.settings).toHaveLength(1);
    expect(web.settings?.[0]).toMatchObject({ id: 'project', level: 'project', adminOnly: true });
    expect(() => registerModules([web])).not.toThrow();
  });

  it('pt6b: панель — номер, название, состояние и ссылка; новее выше', () => {
    st.mrs.value = [
      mr({ iid: 1, title: 'Old', mrUpdatedAt: '2026-10-01T00:00:00.000Z' }),
      mr({ iid: 7, state: 'merged' }),
    ];
    const w = mount(MrPanel, { props: { taskId: 't' } });
    const rows = w.findAll('[data-testid=gl-mr]');
    expect(rows[0]!.text()).toContain('!7 Fix login');
    expect(rows[0]!.get('[data-testid=gl-state]').text()).toBe('merged');
    expect(rows[0]!.get('a').attributes('href')).toBe('https://gl.example/g/p/-/merge_requests/7');
    expect(rows[1]!.text()).toContain('!1 Old');
    // PLNRAPP-104: the branch and whether it is merged
    expect(rows[0]!.get('[data-testid=gl-branch]').text()).toBe('mr/PLN-1branchMerged');
    expect(rows[1]!.get('[data-testid=gl-branch]').text()).toBe('mr/PLN-1branchOpen');
  });

  // IconButton needs the app's TooltipProvider
  const panel = () =>
    mount(
      defineComponent({
        render: () => h(TooltipProvider, null, () => h(MrPanel, { taskId: 't' })),
      }),
    );
  const branch = (o: Record<string, unknown>) => ({
    id: 'b' + Math.random(),
    taskId: 't',
    gitlabProjectId: 5,
    name: 'PLN-1',
    webUrl: 'https://gl.example/g/p/-/tree/PLN-1',
    createdAt: '2026-10-20T09:00:00.000Z',
    ...o,
  });
  const reply = (repos: unknown[], over: Record<string, ReturnType<typeof res>> = {}) =>
    vi.fn(async (path: string, o: { method: string; body?: string }) => {
      calls.push({ method: o.method, path, body: o.body && JSON.parse(o.body) });
      const tail = path.split('/').at(-1)!;
      if (over[tail]) return over[tail];
      if (tail === 'repos') return res(200, { repos });
      if (tail === 'branch-name') return res(200, { name: 'PLN-1-fix-login' });
      if (tail === 'branch') return res(201, { branch: { id: 'b1', name: 'x', webUrl: '' } });
      return res(200, {});
    });
  const posts = () => calls.filter((c) => c.method === 'POST');

  it('PLNRAPP-153: без репозиториев кнопок нет; опрос по задаче', async () => {
    vi.stubGlobal('fetch', reply([]));
    const w0 = panel();
    await flushPromises();
    expect(w0.find('[data-testid=gl-new-branch]').exists()).toBe(false);
    expect(w0.find('[data-testid=gl-poll]').exists()).toBe(false);
    vi.stubGlobal('fetch', reply([{ id: 'c1', path: 'g/p' }]));
    const w = panel();
    await flushPromises();
    await w.get('[data-testid=gl-poll]').trigger('click');
    await flushPromises();
    expect(posts()).toEqual([
      { method: 'POST', path: '/api/gitlab/tasks/t/poll', body: undefined },
    ]);
  });

  it('PLNRAPP-153: диалог ветки — имя по шаблону, правка с проверкой git ref, выбор репозитория', async () => {
    vi.stubGlobal(
      'fetch',
      reply([
        { id: 'c1', path: 'g/p' },
        { id: 'c2', path: 'g/q' },
      ]),
    );
    const w = panel();
    await flushPromises();
    expect(w.find('[data-testid=dialog]').exists()).toBe(false);
    await w.get('[data-testid=gl-new-branch]').trigger('click');
    await flushPromises();
    const input = w.get('[data-testid=gl-branch-input]');
    expect((input.element as HTMLInputElement).value).toBe('PLN-1-fix-login');
    expect(w.findAllComponents({ name: 'Select' })).toHaveLength(1);
    await input.setValue('bad name');
    expect(w.get('[data-testid=gl-branch-create]').attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('пробелов');
    await input.setValue('feature/PLN-1');
    expect(w.get('[data-testid=gl-branch-create]').attributes('disabled')).toBeUndefined();
    await w.get('[data-testid=gl-branch-create]').trigger('click');
    await flushPromises();
    expect(posts()).toEqual([
      {
        method: 'POST',
        path: '/api/gitlab/tasks/t/branch',
        body: { name: 'feature/PLN-1', connectionId: 'c1' },
      },
    ]);
    expect(w.find('[data-testid=dialog]').exists()).toBe(false);
  });

  it('PLNRAPP-153: ошибка создания ветки видна в диалоге', async () => {
    vi.stubGlobal(
      'fetch',
      reply([{ id: 'c1', path: 'g/p' }], { branch: res(502, { message: 'GitLab недоступен' }) }),
    );
    const w = panel();
    await flushPromises();
    expect(w.findAllComponents({ name: 'Select' })).toHaveLength(0);
    await w.get('[data-testid=gl-new-branch]').trigger('click');
    await flushPromises();
    await w.get('[data-testid=gl-branch-create]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid=gl-dialog-err]').text()).toBe('GitLab недоступен');
    expect(w.find('[data-testid=dialog]').exists()).toBe(true);
  });

  it('PLNRAPP-153: MR сгруппированы под своей веткой, чужие — отдельно; «Создать MR» у ветки без открытого MR', async () => {
    st.branches.value = [
      branch({ id: 'b1', name: 'PLN-1', createdAt: '2026-10-20T09:00:00.000Z' }),
      branch({ id: 'b2', name: 'PLN-1-docs', createdAt: '2026-10-21T09:00:00.000Z' }),
      // the same name in another repository is another branch
      branch({
        id: 'b3',
        name: 'PLN-1-docs',
        gitlabProjectId: 6,
        createdAt: '2026-10-19T09:00:00.000Z',
      }),
    ];
    st.mrs.value = [
      mr({ iid: 7, sourceBranch: 'PLN-1', state: 'opened' }),
      mr({ iid: 8, sourceBranch: 'PLN-1-docs', state: 'merged' }),
      mr({ iid: 9, sourceBranch: 'mr/PLN-1', state: 'opened' }),
    ];
    vi.stubGlobal(
      'fetch',
      reply([{ id: 'c1', path: 'g/p' }], {
        mr: res(409, { message: 'MR из этой ветки уже есть' }),
      }),
    );
    const w = panel();
    await flushPromises();
    const groups = w.findAll('[data-testid=gl-branch-group]');
    // newer branches first
    expect(groups.map((g) => g.get('[data-testid=gl-branch-name]').text())).toEqual([
      'PLN-1-docs',
      'PLN-1',
      'PLN-1-docs',
    ]);
    expect(groups.map((g) => g.findAll('[data-testid=gl-mr]').map((m) => m.text()))).toEqual([
      [expect.stringContaining('!8')],
      [expect.stringContaining('!7')],
      [],
    ]);
    // an open MR — no button; merged or none — there is
    expect(groups.map((g) => g.find('[data-testid=gl-new-mr]').exists())).toEqual([
      true,
      false,
      true,
    ]);
    expect(w.get('[data-testid=gl-other]').exists()).toBe(true);
    const other = w.findAll('[data-testid=gl-mr]').filter((m) => m.text().includes('!9'));
    expect(other).toHaveLength(1);
    expect(other[0]!.get('[data-testid=gl-branch]').text()).toContain('mr/PLN-1');
    await groups[0]!.get('[data-testid=gl-new-mr]').trigger('click');
    await flushPromises();
    expect(posts()).toEqual([
      { method: 'POST', path: '/api/gitlab/tasks/t/mr', body: { branchId: 'b2' } },
    ]);
    expect(w.get('[role=alert]').text()).toBe('MR из этой ветки уже есть');
  });

  it('PLNRAPP-822: статус CI у ветки и у ветки открытого MR; клик открывает джобу в новой вкладке', async () => {
    st.branches.value = [
      branch({
        id: 'b1',
        name: 'PLN-1',
        pipelineStatus: 'failed',
        pipelineUrl: 'https://gl.example/g/p/-/jobs/31',
      }),
      branch({ id: 'b2', name: 'PLN-1-docs', createdAt: '2026-10-21T09:00:00.000Z' }),
      branch({
        id: 'b3',
        name: 'PLN-1-x',
        createdAt: '2026-10-18T09:00:00.000Z',
        pipelineStatus: 'running',
        pipelineUrl: 'javascript:alert(1)',
      }),
    ];
    st.mrs.value = [
      mr({
        iid: 9,
        sourceBranch: 'mr/PLN-1',
        pipelineStatus: 'success',
        pipelineUrl: 'https://gl.example/g/p/-/jobs/40',
      }),
      mr({ iid: 10, sourceBranch: 'old', state: 'merged', pipelineStatus: 'success' }),
    ];
    vi.stubGlobal('fetch', reply([]));
    const w = panel();
    await flushPromises();
    const groups = w.findAll('[data-testid=gl-branch-group]');
    const ci = (el: (typeof groups)[number]) => el.find('[data-testid=gl-ci]');
    // no pipeline yet — no status
    expect(ci(groups[0]!).exists()).toBe(false);
    const failed = ci(groups[1]!);
    expect(failed.attributes()).toMatchObject({
      'data-status': 'failed',
      href: 'https://gl.example/g/p/-/jobs/31',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(failed.element.tagName).toBe('A');
    expect(failed.text()).toBe('ci_failed');
    expect(failed.classes()).toContain('text-danger');
    // an unsafe link is not a link, the status is still shown
    const running = ci(groups[2]!);
    expect(running.element.tagName).toBe('SPAN');
    expect(running.attributes('href')).toBeUndefined();
    expect(running.text()).toBe('ci_running');
    // the branch of an open MR of another branch — its head pipeline; of a merged one — none
    const other = w.findAll('[data-testid=gl-branch]');
    expect(other.map((b) => b.find('[data-testid=gl-ci]').exists())).toEqual([true, false]);
    expect(other[0]!.get('[data-testid=gl-ci]').attributes('href')).toBe(
      'https://gl.example/g/p/-/jobs/40',
    );
    expect(other[0]!.get('[data-testid=gl-ci]').text()).toBe('ci_success');
  });

  it('pt6b: панель — пусто и небезопасная ссылка не становится href', () => {
    const w = mount(MrPanel, { props: { taskId: 't' } });
    expect(w.text()).toContain('noMrs');
    st.mrs.value = [mr({ webUrl: 'javascript:alert(1)' })];
    return w.vm.$nextTick().then(() => {
      expect(w.get('a').attributes('href')).toBeUndefined();
    });
  });

  it('pt6b: настройки — подключения проекта, токен не показывается, ошибка видна', async () => {
    const w = await mountSettings();
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/gitlab/projects/p1/connections' });
    const t = w.get('[data-testid=gl-token]');
    expect((t.element as HTMLInputElement).type).toBe('password');
    expect((t.element as HTMLInputElement).value).toBe('');
    expect(w.get('[data-testid=gl-error]').text()).toContain('unauthorized');
    expect(w.findAll('[data-testid=gl-conn]')).toHaveLength(1);
  });

  it('pt6b: новое подключение шлёт адрес, токен и репозиторий; замена токена — PATCH', async () => {
    const w = await mountSettings();
    await w.get('[data-testid=gl-url]').setValue('https://gl.example/');
    await w.get('[data-testid=gl-token]').setValue('glpat-x');
    await w.get('[data-testid=gl-project-input]').setValue(' g/new ');
    await w.get('[data-testid=gl-add-form]').trigger('submit');
    await flushPromises();
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: '/api/gitlab/projects/p1/connections',
      body: { baseUrl: 'https://gl.example/', token: 'glpat-x', project: 'g/new' },
    });
    expect((w.get('[data-testid=gl-token]').element as HTMLInputElement).value).toBe('');
    await w.get('[data-testid=gl-conn-token]').setValue('glpat-y');
    await w.get('[data-testid=gl-conn] form').trigger('submit');
    await flushPromises();
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      path: '/api/gitlab/connections/c1',
      body: { token: 'glpat-y' },
    });
  });

  it('pt6b: убрать подключение, опрос', async () => {
    const w = await mountSettings();
    await w.get('[data-testid=gl-remove]').trigger('click');
    await w.get('[data-testid=gl-poll]').trigger('click');
    await flushPromises();
    expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/connections/c1'))).toBe(
      true,
    );
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/poll'))).toBe(true);
  });

  it('PLNRAPP-153: шаблон имени ветки — текущий из настроек, ошибка у поля, сохранение PUT', async () => {
    st.templates.value = { p1: '{TASK_KEY}-{TASK_NAME}' };
    const w = await mountSettings();
    const input = w.get('[data-testid=gl-template]');
    expect((input.element as HTMLInputElement).value).toBe('{TASK_KEY}-{TASK_NAME}');
    await input.setValue('{TASK_KEY}-{FOO}');
    expect(w.get('[data-testid=gl-template-err]').text()).toContain('{FOO}');
    await w.get('[data-testid=gl-template-form]').trigger('submit');
    await flushPromises();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    await input.setValue('{USER_LOGIN}/{TASK_KEY}');
    expect(w.find('[data-testid=gl-template-err]').exists()).toBe(false);
    await w.get('[data-testid=gl-template-form]').trigger('submit');
    await flushPromises();
    expect(calls.find((c) => c.method === 'PUT')).toEqual({
      method: 'PUT',
      path: '/api/gitlab/projects/p1/branch-template',
      body: { template: '{USER_LOGIN}/{TASK_KEY}' },
    });
    // empty — back to the default
    await input.setValue('');
    await w.get('[data-testid=gl-template-form]').trigger('submit');
    await flushPromises();
    expect(calls.filter((c) => c.method === 'PUT').at(-1)!.body).toEqual({ template: null });
  });

  it('pt6b: «MR смержен → статус» — только статусы пространства проекта, выбор шлёт мутатор', async () => {
    st.merged.value = { p1: 'st2' };
    const w = await mountSettings();
    const sel = w.get('[data-testid=gl-merge-select]');
    expect(sel.findAll('option').map((o) => o.text())).toEqual(['off', 'Todo', 'Done']);
    expect((sel.element as HTMLSelectElement).value).toBe('st2');
    await sel.setValue('st1');
    expect(mutate).toHaveBeenCalledWith('gitlab.setMergedStatus', {
      projectId: 'p1',
      statusId: 'st1',
    });
    await sel.setValue('');
    expect(mutate).toHaveBeenLastCalledWith('gitlab.setMergedStatus', {
      projectId: 'p1',
      statusId: null,
    });
  });
});

describe('карточка: MR, CI', () => {
  const badges = () => mount(CardBadges, { props: { taskId: 't' } });
  it('ничего без данных GitLab', () => {
    expect(badges().text()).toBe('');
  });
  it('без веток; MR — число открытых; CI открытого MR — кольцо «ci», упал — без текста', async () => {
    st.branches.value = [{ id: 'b1', taskId: 't', name: 'PLN-1', webUrl: '', gitlabProjectId: 5 }];
    st.mrs.value = [
      mr({ sourceBranch: 'PLN-1', pipelineStatus: 'running' }),
      mr({ sourceBranch: 'PLN-1-b', state: 'merged', pipelineStatus: 'failed' }),
    ];
    const w = badges();
    expect(w.find('[data-testid="gl-branches"]').exists()).toBe(false);
    expect(w.get('[data-testid="gl-mrs"]').text()).toBe('1');
    // failed of the merged MR's deploy does not count: only open MRs
    expect(w.find('[data-testid="gl-ci-failed"]').exists()).toBe(false);
    expect(w.get('[data-testid="gl-ci-running"]').text()).toBe('ci');
    st.mrs.value = [...st.mrs.value, mr({ sourceBranch: 'PLN-1', pipelineStatus: 'failed' })];
    await flushPromises();
    expect(w.get('[data-testid="gl-ci-failed"]').text()).toBe('');
    expect(w.find('[data-testid="gl-ci-running"]').exists()).toBe(false);
    expect(w.get('[data-testid="gl-mrs"]').text()).toBe('2');
  });
});
