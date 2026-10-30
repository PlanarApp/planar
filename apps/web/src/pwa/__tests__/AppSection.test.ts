import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import AppSection from '../AppSection.vue';

const needRefresh = ref(false);
let opts: { onRegisteredSW?: (u: string, r?: unknown) => void };
vi.mock('../register', () => ({
  useRegisterSW: (o: typeof opts) => (
    (opts = o),
    { needRefresh, updateServiceWorker: vi.fn(async () => {}) }
  ),
}));

async function mountAt(url: string, update = async () => {}) {
  needRefresh.value = false;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/profile', component: { template: '<div />' } }],
  });
  await router.push(url);
  opts?.onRegisteredSW?.('/sw.js', { update }); // onMounted reads ?pwa=check immediately
  const w = mount(AppSection, {
    attachTo: document.body,
    global: {
      plugins: [router, createI18n({ legacy: false, locale: 'en', messages: { en, ru } })],
    },
  });
  opts.onRegisteredSW?.('/sw.js', { update });
  return w;
}
const fire = (name: string) =>
  window.dispatchEvent(
    Object.assign(new Event(name), {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    }),
  );

beforeEach(() => void (document.body.innerHTML = ''));

describe('AppSection', () => {
  it('check shows result', async () => {
    const w = await mountAt('/profile');
    expect(w.get('[data-testid=pwa-status]').text()).toBe(en.pwa.state.idle);
    await w.get('[data-testid=pwa-check]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid=pwa-status]').text()).toBe(en.pwa.state.current);
  });
  it('check error', async () => {
    const w = await mountAt('/profile', () => Promise.reject(new Error('x')));
    await w.get('[data-testid=pwa-check]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid=pwa-status]').text()).toBe(en.pwa.state.error);
  });
  it('?pwa=check runs the check', async () => {
    const w = await mountAt('/profile?pwa=check');
    await flushPromises();
    expect(w.get('[data-testid=pwa-status]').text()).toBe(en.pwa.state.current);
  });
  it('?pwa=install opens the dialog with unavailable note', async () => {
    await mountAt('/profile?pwa=install');
    await flushPromises();
    expect(document.body.textContent).toContain(en.pwa.installNA);
  });
  it('install button appears on beforeinstallprompt and opens the dialog', async () => {
    const w = await mountAt('/profile');
    expect(w.find('[data-testid=pwa-install]').exists()).toBe(false);
    fire('beforeinstallprompt');
    await flushPromises();
    await w.get('[data-testid=pwa-install]').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain(en.pwa.installTitle);
    expect(document.body.textContent).toContain(en.pwa.install);
  });
});
