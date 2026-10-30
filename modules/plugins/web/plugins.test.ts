import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  plugins: null as unknown,
  user: null as unknown,
  route: null as unknown,
}));
const createBridge = vi.hoisted(() => vi.fn(() => ({ onMessage: vi.fn() })));

vi.mock('vue-router', () => ({ useRoute: () => state.route }));
vi.mock('./bridge.js', () => ({ createBridge }));
vi.mock('./data.js', () => ({
  usePlugins: () => state.plugins,
  useSession: () => state.user,
  useRouter: () => ({ push: vi.fn() }),
  queryReplica: vi.fn(),
  mutateVia: vi.fn(),
  locale: () => 'ru',
  theme: () => 'light',
  tr: (k: string) => k,
}));

import Page from './Page.vue';
import PluginFrame from './PluginFrame.vue';
import { ensureFrameCsp, resetFrameCsp } from './csp.js';

const plugin = {
  id: 'p1',
  name: 'Hello',
  url: 'https://plugin.example/index.html',
  origin: 'https://plugin.example',
  permissions: { read: ['tasks'], write: [] },
  points: { taskPanel: null, page: { label: 'H' } },
  enabled: true,
};

beforeEach(() => {
  // happy-dom does not load iframes (contentWindow = null)
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    configurable: true,
    get: () => ({ postMessage: vi.fn() }),
  });
  resetFrameCsp();
  document.head.innerHTML = '';
  createBridge.mockClear();
  state.plugins = ref([plugin]);
  state.user = ref({ id: 'u', name: 'N', login: 'l', role: 'member' });
  state.route = { params: { pluginId: 'p1' } };
});

describe('pf5: web', () => {
  it('pf5: Page.vue монтируется без ошибки, ставит CSP и показывает sandbox-iframe', async () => {
    const w = mount(Page, { attachTo: document.body });
    await flushPromises();
    const f = w.find('iframe');
    expect(f.exists()).toBe(true);
    expect(f.attributes('sandbox')).toBe('allow-scripts allow-forms allow-same-origin');
    expect(document.head.innerHTML).toContain('frame-src https://plugin.example');
    expect(createBridge).toHaveBeenCalledTimes(1);
  });
  it('pf5: Page.vue: список не загружен — ни CSP, ни iframe', async () => {
    state.plugins = ref(undefined);
    const w = mount(Page, { attachTo: document.body });
    await flushPromises();
    expect(w.find('iframe').exists()).toBe(false);
    expect(document.head.innerHTML).not.toContain('Content-Security-Policy');
  });
  it('pf5: мост создаётся, когда сессия появляется после монтирования', async () => {
    ensureFrameCsp([plugin.origin]);
    const user = ref<unknown>(null);
    state.user = user;
    const w = mount(PluginFrame, { props: { plugin, context: { point: 'page' } } as never });
    await flushPromises();
    expect(w.find('iframe').exists()).toBe(false);
    expect(createBridge).not.toHaveBeenCalled();
    user.value = { id: 'u', name: 'N', login: 'l', role: 'member' };
    await nextTick();
    await flushPromises();
    expect(w.find('iframe').exists()).toBe(true);
    expect(createBridge).toHaveBeenCalledTimes(1);
  });
});
