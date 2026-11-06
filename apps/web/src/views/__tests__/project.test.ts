import 'fake-indexeddb/auto';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from 'reka-ui';
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
  mount(defineComponent({ render: () => h(TooltipProvider, null, () => h(ProjectScreen)) }), {
    global: {
      plugins: [r, createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })],
    },
  });

// view layouts are buttons in the teleported "View" popover (PLNRAPP-71)
async function layoutButtons(w: ReturnType<typeof mountScreen>) {
  await w.get('[data-testid=view-toggle]').trigger('click');
  const body = new DOMWrapper(document.body);
  await vi.waitFor(() => expect(body.find('[data-testid=view-layout]').exists()).toBe(true));
  return body.findAll('[data-testid=view-layout] button');
}

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
    const btns = await layoutButtons(w);
    expect(btns.map((x) => x.text())).toEqual(['Список', 'Доска']);
    await btns[1].trigger('click');
    await flushPromises();
    expect(r.currentRoute.value.path).toBe(`/p/${project}/board`);
    await vi.waitFor(() => expect(w.get('[data-testid=view]').attributes('data-id')).toBe('board'));
    w.unmount();
  });

  it(':view выбирает вид', async () => {
    await r.push(`/p/${project}/board`);
    const w = mountScreen();
    await vi.waitFor(() =>
      expect(w.find('[data-testid=view]').attributes('data-id')).toBe('board'),
    );
    const pressed = (await layoutButtons(w)).filter((b) => b.attributes('aria-pressed') === 'true');
    expect(pressed.map((b) => b.text())).toEqual(['Доска']);
    w.unmount();
  });

  it('PJ-9: ?task открывает и закрывает панель; mobile — тот же ?task поверх вида', async () => {
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
    expect(r.currentRoute.value.path).toBe(`/p/${project}`);
    expect(r.currentRoute.value.query.task).toBe('PRJ-2');
    await vi.waitFor(() => expect(w.find('[data-testid=panel]').exists()).toBe(true));
    closeTask();
    await flushPromises();
  });

  it('PLNRAPP-65: незакреплённая боковая панель — поверх экрана; кнопка закрепления отодвигает экран', async () => {
    const { taskOpenMode } = await import('../open');
    const { sidePanels, setTaskPanelPinned } = await import('../../ui/taskPanelWidth');
    taskOpenMode.value = 'side';
    setTaskPanelPinned(false);
    const before = sidePanels.value;
    const w = mountScreen();
    await flushPromises();
    openTask('PRJ-4');
    await vi.waitFor(() => expect(w.find('[data-testid=task-side]').exists()).toBe(true));
    expect(sidePanels.value).toBe(before);
    // the panel is stubbed here; the pin button itself — task.test.ts
    setTaskPanelPinned(true);
    await flushPromises();
    expect(sidePanels.value).toBeGreaterThan(before); // wrappers of earlier tests stay mounted
    expect(localStorage.getItem('planar.taskPanelPinned')).toBe('1');
    closeTask();
    await flushPromises();
    w.unmount();
    taskOpenMode.value = 'modal';
  });

  it('PLANARAPP-63: Esc закрывает боковую панель и возвращает место экрану', async () => {
    const { taskOpenMode } = await import('../open');
    const { sidePanels, setTaskPanelPinned } = await import('../../ui/taskPanelWidth');
    taskOpenMode.value = 'side';
    setTaskPanelPinned(true);
    const w = mountScreen();
    await flushPromises();
    openTask('PRJ-4');
    await vi.waitFor(() => expect(w.find('[data-testid=task-side]').exists()).toBe(true));
    expect(sidePanels.value).toBeGreaterThan(0); // wrappers of earlier tests stay mounted
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.find('[data-testid=task-side]').exists()).toBe(false);
    expect(sidePanels.value).toBe(0);
    taskOpenMode.value = 'modal';
  });

  it('режим «страница» ведёт на /t/<key> и на десктопе', async () => {
    const { taskOpenMode } = await import('../open');
    mountScreen();
    await flushPromises();
    taskOpenMode.value = 'page';
    openTask('PRJ-3');
    await flushPromises();
    expect(r.currentRoute.value.path).toBe('/t/PRJ-3');
    taskOpenMode.value = 'modal';
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
