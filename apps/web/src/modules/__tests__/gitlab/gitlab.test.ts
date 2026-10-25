import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../../modules/gitlab/web/data', async () => {
  const { ref } = await import('vue');
  const state = {
    mrs: ref<unknown[]>([]),
    projects: ref<unknown[]>([]),
    statuses: ref<unknown[]>([]),
    merged: ref<Record<string, string | null>>({}),
  };
  return {
    __state: state,
    mutate: vi.fn(async () => {}),
    tr: (k: string) => k,
    useMrs: () => state.mrs,
    useProjects: () => state.projects,
    useStatusList: () => state.statuses,
    useMergedStatuses: () => state.merged,
  };
});

import * as data from '../../../../../../modules/gitlab/web/data';
import { web } from '../../../../../../modules/gitlab/web';
import MrPanel from '../../../../../../modules/gitlab/web/MrPanel.vue';
import Settings from '../../../../../../modules/gitlab/web/GitlabSettings.vue';
import { registerModules } from '../../registry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const st = (data as unknown as { __state: Record<string, { value: any }> }).__state;
const mutate = data.mutate as unknown as ReturnType<typeof vi.fn>;

const mr = (o: Record<string, unknown>) => ({
  id: 'm' + Math.random(),
  taskId: 't',
  iid: 7,
  title: 'Fix login',
  state: 'opened',
  webUrl: 'https://gl.example/g/p/-/merge_requests/7',
  mrUpdatedAt: '2026-10-20T10:00:00.000Z',
  ...o,
});

const cfg = {
  baseUrl: 'https://gl.example',
  hasToken: true,
  intervalSec: 120,
  lastError: 'unauthorized',
  lastErrorAt: null,
  projects: [{ id: 'gp1', gitlabProjectId: 5, path: 'g/p', lastPolledAt: null, lastError: null }],
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
  st.projects.value = [{ id: 'p1', spaceId: 's1', name: 'Proj' }];
  st.statuses.value = [
    { id: 'st1', spaceId: 's1', name: 'Todo' },
    { id: 'st2', spaceId: 's1', name: 'Done' },
    { id: 'st3', spaceId: 's2', name: 'Other' },
  ];
  st.merged.value = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, o: { method: string; body?: string }) => {
      calls.push({ method: o.method, path, body: o.body && JSON.parse(o.body) });
      if (o.method === 'DELETE' || path.endsWith('/poll')) return res(204);
      return res(200, cfg);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const mountSettings = async () => {
  const w = mount(Settings);
  await flushPromises();
  return w;
};

describe('pt6b:', () => {
  it('pt6b: манифест — панель задачи и настройки только для админа', () => {
    expect(web.taskPanels?.[0]?.id).toBe('mrs');
    expect(web.settings?.[0]).toMatchObject({ id: 'settings', adminOnly: true });
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
  });

  it('pt6b: панель — пусто и небезопасная ссылка не становится href', () => {
    const w = mount(MrPanel, { props: { taskId: 't' } });
    expect(w.text()).toContain('noMrs');
    st.mrs.value = [mr({ webUrl: 'javascript:alert(1)' })];
    return w.vm.$nextTick().then(() => {
      expect(w.get('a').attributes('href')).toBeUndefined();
    });
  });

  it('pt6b: настройки — токен не показывается, ошибка и проекты видны', async () => {
    const w = await mountSettings();
    const t = w.get('[data-testid=gl-token]');
    expect((t.element as HTMLInputElement).type).toBe('password');
    expect((t.element as HTMLInputElement).value).toBe('');
    expect(w.get('[data-testid=gl-error]').text()).toContain('unauthorized');
    expect(w.findAll('[data-testid=gl-project]')).toHaveLength(1);
  });

  it('pt6b: сохранение шлёт адрес, интервал и токен только если введён', async () => {
    const w = await mountSettings();
    await w.get('form').trigger('submit');
    await flushPromises();
    let put = calls.filter((c) => c.method === 'PUT').at(-1)!;
    expect(put.body).toEqual({ baseUrl: 'https://gl.example', intervalSec: 120 });
    await w.get('[data-testid=gl-token]').setValue('glpat-x');
    await w.get('form').trigger('submit');
    await flushPromises();
    put = calls.filter((c) => c.method === 'PUT').at(-1)!;
    expect(put.body).toMatchObject({ token: 'glpat-x' });
    await w.get('[data-testid=gl-token-del]').trigger('click');
    await flushPromises();
    expect(calls.filter((c) => c.method === 'PUT').at(-1)!.body).toMatchObject({ token: null });
  });

  it('pt6b: добавить и убрать проект, опрос', async () => {
    const w = await mountSettings();
    await w.get('[data-testid=gl-project-input]').setValue('g/new');
    await w.findAll('form')[1]!.trigger('submit');
    await flushPromises();
    expect(calls.find((c) => c.path.endsWith('/projects'))!.body).toEqual({ project: 'g/new' });
    await w.get('[data-testid=gl-remove]').trigger('click');
    await w.get('[data-testid=gl-poll]').trigger('click');
    await flushPromises();
    expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/projects/gp1'))).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/poll'))).toBe(true);
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
