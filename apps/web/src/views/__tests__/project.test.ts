import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { uuidv7 } from '@planar/shared';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { db } from '../../sync';
import { resetBreakpoint } from '../../ui';

const { router } = vi.hoisted(() => ({ router: { current: undefined as never } }));
vi.mock('../../router', async () => {
  const vr = await import('vue-router');
  const stub = { template: '<div />' };
  const r = vr.createRouter({
    history: vr.createMemoryHistory(),
    routes: [
      { path: '/p/:projectId/:view?', name: 'project', component: stub },
      { path: '/t/:key', name: 'task', component: stub },
    ],
  });
  router.current = r as never;
  return { router: r };
});
const stubView = (id: string) => async () => ({
  __esModule: true,
  default: defineComponent({
    props: ['projectId', 'options'],
    setup: (p) => () =>
      h('div', { 'data-testid': 'view', 'data-id': id }, `${p.projectId}|${p.options.groupBy}`),
  }),
});
vi.mock('../open', async (orig) => ({
  ...(await orig<typeof import('../open')>()),
  viewLoaders: () => ({
    '../views/list/View.vue': stubView('list'),
    '../views/board/View.vue': stubView('board'),
  }),
  taskPanelLoader: async () => ({
    __esModule: true,
    default: defineComponent({
      props: ['taskKey', 'mode'],
      setup: (p) => () => h('div', { 'data-testid': 'panel' }, `${p.taskKey}/${p.mode}`),
    }),
  }),
}));

const { buildViewTabs, closeTask, openTask, useSelection, useViewOptions } = await import('..');
const ProjectScreen = (await import('../../screens/ProjectScreen.vue')).default;
const r = router.current as import('vue-router').Router;

const T = '2026-10-22T10:00:00.000Z';
const space = uuidv7();
const project = uuidv7();
const load = async () => ({ default: { template: '<div data-testid="v" />' } });

function mockMq(mobile: boolean) {
  resetBreakpoint();
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes('max-width') ? mobile : false,
    addEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}
const mountScreen = () =>
  mount(ProjectScreen, {
    global: {
      plugins: [r, createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })],
    },
  });

beforeEach(async () => {
  mockMq(false);
  localStorage.clear();
  useSelection().clear();
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.table('projects').put({
    id: project,
    spaceId: space,
    name: 'Проект',
    key: 'PRJ',
    rank: 'a0',
    createdAt: T,
    updatedAt: T,
  });
  await r.push(`/p/${project}`);
});

describe('views:project', () => {
  it('вкладки по glob: list, board, затем остальные; без файла — пусто', () => {
    const g = (id: string) => [`../views/${id}/View.vue`, load] as const;
    const keys = buildViewTabs(Object.fromEntries([g('zeta'), g('board'), g('list')]), []).map(
      (v) => v.key,
    );
    expect(keys).toEqual(['list', 'board', 'zeta']);
    expect(buildViewTabs({}, [])).toEqual([]);
  });

  it('вид по умолчанию — list и получает ViewProps; клик по вкладке меняет маршрут', async () => {
    const w = mountScreen();
    await vi.waitFor(() => expect(w.find('[data-testid=view]').exists()).toBe(true));
    expect(w.get('[data-testid=view]').attributes('data-id')).toBe('list');
    expect(w.get('[data-testid=view]').text()).toBe(`${project}|status`);
    const tabs = w.findAll('[role=tab]');
    expect(tabs.map((x) => x.text())).toEqual(['Список', 'Доска']);
    await tabs[1].trigger('click');
    await flushPromises();
    expect(r.currentRoute.value.path).toBe(`/p/${project}/board`);
    await vi.waitFor(() => expect(w.get('[data-testid=view]').attributes('data-id')).toBe('board'));
  });

  it(':view выбирает вид', async () => {
    await r.push(`/p/${project}/board`);
    const w = mountScreen();
    await vi.waitFor(() =>
      expect(w.find('[data-testid=view]').attributes('data-id')).toBe('board'),
    );
    expect(w.get('[aria-selected=true]').text()).toBe('Доска');
  });

  it('?task открывает и закрывает панель; mobile — ведёт на /t/<key>', async () => {
    const w = mountScreen();
    await flushPromises();
    openTask('PRJ-1');
    await vi.waitFor(() => expect(w.find('[data-testid=panel]').exists()).toBe(true));
    expect(r.currentRoute.value.query.task).toBe('PRJ-1');
    expect(w.get('[data-testid=panel]').text()).toBe('PRJ-1/panel');
    closeTask();
    await flushPromises();
    expect(w.find('[data-testid=panel]').exists()).toBe(false);
    mockMq(true);
    openTask('PRJ-2');
    await flushPromises();
    expect(r.currentRoute.value.path).toBe('/t/PRJ-2');
  });

  it('смена проекта очищает выделение', async () => {
    const w = mountScreen();
    await flushPromises();
    const s = useSelection();
    s.set(['a', 'b']);
    await r.push(`/p/${uuidv7()}`);
    await flushPromises();
    expect(s.selected.value.size).toBe(0);
    w.unmount();
  });

  it('проект не найден', async () => {
    await r.push(`/p/${uuidv7()}`);
    const w = mountScreen();
    await vi.waitFor(() => expect(w.text()).toContain('Проект не найден'));
  });

  it('useViewOptions сохраняет и читает localStorage', async () => {
    const o = useViewOptions('p1', 'list');
    o.value.groupBy = 'priority';
    await nextTick();
    expect(JSON.parse(localStorage.getItem('planar.view.p1.list') ?? '{}').groupBy).toBe(
      'priority',
    );
    expect(useViewOptions('p1', 'list').value.groupBy).toBe('priority');
    expect(useViewOptions('p1', 'board').value.groupBy).toBe('status');
  });
});
