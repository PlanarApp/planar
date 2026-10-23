import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { resetBreakpoint, useTheme } from '../../ui/index';
import AppShell from '../AppShell.vue';
import Sidebar from '../Sidebar.vue';

const stub = { template: '<div />' };

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
    const w = mount(AppShell, { global: { plugins: [router, i18n] } });
    await router.isReady();
    expect(w.find('[data-testid=sidebar]').exists()).toBe(true);
    expect(w.find('[data-testid=bottom-nav]').exists()).toBe(false);
  });

  it('375: есть нижняя навигация, нет боковой панели', async () => {
    const { router, i18n } = setup(true);
    const w = mount(AppShell, { global: { plugins: [router, i18n] } });
    await router.isReady();
    expect(w.find('[data-testid=sidebar]').exists()).toBe(false);
    expect(w.find('[data-testid=bottom-nav]').exists()).toBe(true);
  });

  it('useTheme ставит и снимает класс dark', () => {
    setup(false);
    const { theme } = useTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    theme.value = 'light';
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('смена локали меняет текст Inbox', async () => {
    const { router, i18n } = setup(false);
    const w = mount(Sidebar, { global: { plugins: [router, i18n] } });
    expect(w.text()).toContain('Входящие');
    i18n.global.locale.value = 'en';
    await nextTick();
    expect(w.text()).toContain('Inbox');
  });
});
