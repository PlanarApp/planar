import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../i18n/en';
import ru from '../i18n/ru';

// PLNRAPP-479: banner over the app in DEMO_MODE; the flag comes from /api/setup
const setupInfo = vi.fn();
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ setupInfo }) }));
vi.mock('../pwa/usePwa', async () => {
  const { ref } = await import('vue');
  return {
    usePwa: () => ({
      needRefresh: ref(false),
      downloading: ref(false),
      applying: ref(false),
      applyUpdate: () => {},
    }),
  };
});
vi.mock('../layout/AppShell.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../command/CommandHost.vue', () => ({ default: { template: '<div />' } }));
import App from '../App.vue';

async function render() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }],
  });
  const i18n = createI18n({
    legacy: false,
    locale: 'ru',
    fallbackLocale: 'ru',
    messages: { ru, en },
  });
  await router.push('/');
  const w = mount(App, { global: { plugins: [router, i18n] } });
  await router.isReady();
  await flushPromises();
  return w;
}

describe('PLNRAPP-479: баннер демо-режима', () => {
  beforeEach(() => setupInfo.mockReset());

  it('DEMO_MODE включён — над приложением полоса-баннер', async () => {
    setupInfo.mockResolvedValue({ demo: true, demoResetHours: 24 });
    const w = await render();
    const banner = w.find('[role=status]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toBe('Демо — данные сбрасываются каждые 24 ч');
  });

  it('DEMO_MODE выключен — баннера нет', async () => {
    setupInfo.mockResolvedValue({ demo: false, demoResetHours: 24 });
    const w = await render();
    expect(w.text()).not.toContain('Демо');
    expect(w.find('[role=status]').exists()).toBe(false);
  });

  it('высота баннера — в --banner-h: боковая панель задачи встаёт под тулбар, а не на него', async () => {
    // happy-dom не считает раскладку: высоту и наблюдатель задаём руками
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private cb: () => void) {}
        observe() {
          this.cb();
        }
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(24);
    setupInfo.mockResolvedValue({ demo: true, demoResetHours: 24 });
    const w = await render();
    expect(document.documentElement.style.getPropertyValue('--banner-h')).toBe('24px');
    w.unmount();
    expect(document.documentElement.style.getPropertyValue('--banner-h')).toBe('');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
