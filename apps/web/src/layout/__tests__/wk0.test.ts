import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { TooltipProvider } from 'reka-ui';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createI18n } from 'vue-i18n';
import { describe, expect, it, vi } from 'vitest';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { domainMutators, uuidv7 } from '@planar/shared';
import { db, registerMutators, startSync } from '../../sync';
import { i18n as appI18n } from '../../i18n';
import { setWeekStart, useWeekStart } from '../../i18n/week';
import { registerModules, setEnabledModules } from '../../modules/registry';
import Sidebar from '../Sidebar.vue';
import TopBar from '../TopBar.vue';
import { favorites } from '../nav';

const stub = { template: '<div />' };
const plugins = () => [
  createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: stub }] }),
  createI18n({ legacy: false, locale: 'ru', fallbackLocale: 'ru', messages: { ru, en } }),
];
const Icon = defineComponent({ render: () => h('i') });

describe('wk0: модули nav/topbar', () => {
  it('wk0: registry отвергает nav.to вне /m/<id>/', () => {
    expect(() =>
      registerModules([{ id: 'navbad', nav: [{ id: 'x', label: 'x', icon: Icon, to: '/other' }] }]),
    ).toThrow(/navbad/);
  });

  it('wk0: Sidebar показывает nav включённого модуля по order', async () => {
    registerModules([
      {
        id: 'navok',
        nav: [
          {
            id: 'b',
            label: { ru: 'Второй', en: 'Second' },
            icon: Icon,
            to: '/m/navok/b',
            order: 2,
          },
          { id: 'a', label: { ru: 'Первый', en: 'First' }, icon: Icon, to: '/m/navok/a', order: 1 },
        ],
      },
    ]);
    await setEnabledModules(['navok']);
    const w = mount(Sidebar, { global: { plugins: plugins() } });
    const links = w.findAll('a[href^="/m/navok/"]');
    expect(links.map((l) => l.text())).toEqual(['Первый', 'Второй']);
    // after the built-in items
    expect(w.find('nav').text().indexOf('Первый')).toBeGreaterThan(
      w.find('nav').text().indexOf('Мои задачи'),
    );
    await setEnabledModules([]);
    await nextTick();
    expect(w.findAll('a[href^="/m/navok/"]')).toHaveLength(0);
  });

  it('wk0: nav-секция рисуется компонентом, без to и section — Error', async () => {
    const Sec = defineComponent({ render: () => h('section', 'Каналы') });
    registerModules([
      {
        id: 'navsec',
        nav: [
          { id: 's', section: () => Promise.resolve({ __esModule: true, default: Sec } as never) },
        ],
      },
    ]);
    await setEnabledModules(['navsec']);
    const w = mount(Sidebar, { global: { plugins: plugins() } });
    await flushPromises();
    expect(w.text()).toContain('Каналы');
    expect(() => registerModules([{ id: 'navnone', nav: [{ id: 'x' } as never] }])).toThrow();
  });

  it('wk0: TopBar показывает topbar-компонент модуля', async () => {
    const Comp = defineComponent({ render: () => h('b', 'T') });
    registerModules([
      {
        id: 'tbok',
        topbar: [
          {
            id: 't',
            component: () => Promise.resolve({ __esModule: true, default: Comp } as never),
          },
        ],
      },
    ]);
    await setEnabledModules(['tbok']);
    const w = mount(defineComponent({ render: () => h(TooltipProvider, null, () => h(TopBar)) }), {
      global: { plugins: plugins() },
    });
    await flushPromises();
    expect(w.find('[data-testid=topbar-item]').exists()).toBe(true);
  });
});

describe('шапка узла: имя и звезда избранного', () => {
  it('проект: звезда добавляет в избранное и снимает', async () => {
    // favourites are written by favorite.* mutators (PLNRAPP-124)
    registerMutators(domainMutators);
    await startSync({
      userId: uuidv7(),
      fetch: (() => Promise.reject(new TypeError('offline'))) as never,
    });
    await db.table('spaces').put({ id: 's1', name: 'Разработка', rank: 'a0' });
    await db
      .table('projects')
      .put({ id: 'p1', spaceId: 's1', name: 'Планар', key: 'PLN', rank: 'a0', archivedAt: null });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/p/:projectId/:view?', name: 'project', component: stub }],
    });
    await router.push('/p/p1/board');
    const [, i18n] = plugins();
    const w = mount(defineComponent({ render: () => h(TooltipProvider, null, () => h(TopBar)) }), {
      global: { plugins: [router, i18n] },
    });
    await vi.waitFor(() => expect(w.get('[data-testid=topbar-node-link]').text()).toBe('Планар'));
    const star = () => w.get('[data-testid=topbar-favorite]');
    expect(star().attributes('aria-pressed')).toBe('false');
    await star().trigger('click');
    await vi.waitFor(() => expect(star().attributes('aria-pressed')).toBe('true'));
    expect(favorites.has('project', 'p1')).toBe(true);
    await star().trigger('click');
    await vi.waitFor(() => expect(favorites.has('project', 'p1')).toBe(false));
  });
});

describe('wk0: useWeekStart', () => {
  it('wk0: auto — по локали: en → 0, ru → 1', async () => {
    setWeekStart('auto');
    const ws = useWeekStart();
    appI18n.global.locale.value = 'en';
    expect(ws.value).toBe(0);
    appI18n.global.locale.value = 'ru';
    expect(ws.value).toBe(1);
  });

  it('wk0: явное значение хранится в localStorage', () => {
    const ws = useWeekStart();
    setWeekStart(0);
    expect(ws.value).toBe(0);
    expect(localStorage.getItem('planar.weekStart')).toBe('0');
    setWeekStart(1);
    expect(ws.value).toBe(1);
    expect(localStorage.getItem('planar.weekStart')).toBe('1');
    setWeekStart('auto');
    expect(localStorage.getItem('planar.weekStart')).toBeNull();
  });

  it('wk0: localStorage недоступен — значение живёт в памяти', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const ws = useWeekStart();
    expect(() => setWeekStart(0)).not.toThrow();
    expect(ws.value).toBe(0);
    spy.mockRestore();
    setWeekStart('auto');
  });
});
