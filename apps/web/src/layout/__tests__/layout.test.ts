import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { TooltipProvider } from 'reka-ui';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { resetBreakpoint, useTheme } from '../../ui/index';
import AppShell from '../AppShell.vue';
import Sidebar from '../Sidebar.vue';
import TopBar from '../TopBar.vue';

// AppShell mounts the install offer (PLNRAPP-67): the service worker registration is not needed here
vi.mock('../../pwa/register', () => ({
  useRegisterSW: () => ({ needRefresh: { value: false }, updateServiceWorker: async () => {} }),
}));
import { ui } from '../../command/hotkeys';

const stub = { template: '<div />' };
// Tooltip (IconButton) requires a provider, which the app mounts in App.vue
const withTips = (c: object) =>
  defineComponent({ render: () => h(TooltipProvider, null, () => h(c)) });

function setup(mobile: boolean) {
  resetBreakpoint();
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes('max-width') ? mobile : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:p(.*)*', component: stub }],
  });
  const i18n = createI18n({
    legacy: false,
    locale: 'ru',
    fallbackLocale: 'ru',
    messages: { ru, en },
  });
  return { router, i18n };
}

describe('раскладка', () => {
  beforeEach(() => document.documentElement.classList.remove('dark'));

  it('1280: есть боковая панель, нет нижней навигации', async () => {
    const { router, i18n } = setup(false);
    const w = mount(withTips(AppShell), { global: { plugins: [router, i18n] } });
    await router.isReady();
    expect(w.find('[data-testid=sidebar]').exists()).toBe(true);
    expect(w.find('[data-testid=bottom-nav]').exists()).toBe(false);
  });

  it('PLANARAPP-64: ?welcome=1 после первого входа — подсказка логина, параметр убирается', async () => {
    const { toasts } = await import('../../ui/toast');
    const { router, i18n } = setup(false);
    await router.push('/w?welcome=1');
    mount(withTips(AppShell), { global: { plugins: [router, i18n] } });
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/w'));
    expect(toasts.value.at(-1)?.text).toContain('логином admin');
  });

  it('375: нет нижней навигации и боковой панели', async () => {
    const { router, i18n } = setup(true);
    const w = mount(withTips(AppShell), { global: { plugins: [router, i18n] } });
    await router.isReady();
    expect(w.find('[data-testid=sidebar]').exists()).toBe(false);
    expect(w.find('[data-testid=bottom-nav]').exists()).toBe(false);
  });

  it('375: кнопка «меню» в TopBar открывает Sidebar в выезжающей панели', async () => {
    const { router, i18n } = setup(true);
    const w = mount(withTips(AppShell), {
      global: { plugins: [router, i18n] },
      attachTo: document.body,
    });
    await router.isReady();
    await w.find('button[aria-label="Навигация"]').trigger('click');
    await vi.waitFor(() => expect(document.querySelector('[data-testid=sidebar]')).not.toBeNull());
    await router.push('/inbox');
    await vi.waitFor(() => expect(document.querySelector('[data-testid=sidebar]')).toBeNull());
    w.unmount();
  });

  it('375: клик по ссылке на текущий маршрут закрывает панель', async () => {
    const { router, i18n } = setup(true);
    await router.push('/w');
    const w = mount(withTips(AppShell), {
      global: { plugins: [router, i18n] },
      attachTo: document.body,
    });
    await router.isReady();
    await w.find('button[aria-label="Навигация"]').trigger('click');
    await vi.waitFor(() => expect(document.querySelector('[data-testid=sidebar]')).not.toBeNull());
    document.querySelector<HTMLElement>('[data-testid=sidebar] a[href="/w"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid=sidebar]')).toBeNull());
    w.unmount();
  });

  it('useTheme ставит и снимает класс dark', () => {
    setup(false);
    const { theme } = useTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    theme.value = 'light';
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('смена локали меняет текст панели', async () => {
    const { router, i18n } = setup(false);
    const w = mount(Sidebar, { global: { plugins: [router, i18n] } });
    expect(w.text()).toContain('Настройки');
    i18n.global.locale.value = 'en';
    await nextTick();
    expect(w.text()).toContain('Settings');
  });

  it('боковая панель: группы сворачиваются, состояние пишется в localStorage', async () => {
    localStorage.removeItem('planar.sidebar.collapsed');
    const { router, i18n } = setup(false);
    const w = mount(Sidebar, { global: { plugins: [router, i18n] } });
    // tree root — "All"; its chevron collapses spaces
    expect(w.get('[data-testid=nav-workspace]').text()).toBe('Всё');
    expect(w.text()).not.toContain('Избранное'); // empty — hidden
    const head = w.get('[data-testid=nav-workspace] button');
    expect(head.attributes('aria-expanded')).toBe('true');
    await head.trigger('click');
    expect(head.attributes('aria-expanded')).toBe('false');
    expect(JSON.parse(localStorage.getItem('planar.sidebar.collapsed')!)).toEqual({ spaces: true });
    await head.trigger('click');
  });

  it('верхняя панель: без крошек и звезды вне узла, поиск открывает палитру, чата нет', async () => {
    const { i18n } = setup(false);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/inbox', name: 'inbox', component: stub }],
    });
    await router.push('/inbox');
    const w = mount(withTips(TopBar), { global: { plugins: [router, i18n] } });
    expect(w.find('h1').exists()).toBe(false);
    expect(w.find('[data-testid=topbar-favorite]').exists()).toBe(false);
    expect(w.find('[data-testid=chat-topbar]').exists()).toBe(false);
    await w.find('button[aria-label="Поиск и команды"]').trigger('click');
    expect(ui.palette).toBe(true);
    ui.palette = false;
  });
});
