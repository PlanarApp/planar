import 'fake-indexeddb/auto';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createI18n } from 'vue-i18n';
import { describe, expect, it, vi } from 'vitest';
import en from '../../i18n/en';
import ru from '../../i18n/ru';

// spaces are already loaded when the Sidebar mounts — the mobile drawer mounts on open
vi.mock('../nav', async (orig) => ({
  ...(await orig<typeof import('../nav')>()),
  useNavData: () => ({
    spaces: ref([
      {
        id: 's1',
        name: 'Разработка',
        color: null,
        icon: null,
        rank: 'a0',
        projects: [{ id: 'p1', name: 'Ядро', rank: 'a0', prefix: 'CORE', color: null, icon: null }],
      },
    ]),
    favorites: ref([]),
    loading: ref(false),
  }),
}));
const prefetchIdle = vi.fn();
vi.mock('../../tasks/queries', async (orig) => ({
  ...(await orig<typeof import('../../tasks/queries')>()),
  prefetchIdle: (ids: string[]) => prefetchIdle(ids),
}));
import Sidebar from '../Sidebar.vue';

describe('PLNRAPP-888: открытие сайдбара с уже загруженными пространствами', () => {
  it('монтируется без ошибки и подгружает проекты в простое', async () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
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
    const w = mount(Sidebar, {
      global: {
        plugins: [router, i18n],
        config: { errorHandler: (e) => void errors.push(e) },
      },
    });
    expect(errors).toEqual([]);
    expect(w.find('[data-testid=sidebar]').exists()).toBe(true);
    vi.advanceTimersByTime(600);
    expect(prefetchIdle).toHaveBeenCalledWith(['p1']);
    w.unmount();
    vi.useRealTimers();
  });
});
