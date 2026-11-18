import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import { useAuth, type User } from '../../../auth/useAuth';
import SettingsScreen from '../../SettingsScreen.vue';
import { i18n, setup } from './setup';

setup();
// useBreakpoint remembers the first answer for the whole module — mobile from the start
window.matchMedia = vi
  .fn()
  .mockReturnValue({ matches: true, addEventListener() {} }) as unknown as typeof window.matchMedia;

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/settings/:section?', component: SettingsScreen }],
});

describe('PLNRAPP-448: вкладки разделов на мобильном', () => {
  it('полоса вкладок — вверху, без боковых отступов контента; отступ — только у раздела', async () => {
    useAuth().user.value = { id: 'u', role: 'member' } as User;
    await router.push('/settings/general');
    document.body.innerHTML = '';
    const w = mount(SettingsScreen, {
      global: { plugins: [i18n, router] },
      attachTo: document.body,
    });
    await flushPromises();
    const root = w.element as HTMLElement;
    const strip = w.find('[data-testid=settings-tabs]');
    expect(strip.exists()).toBe(true);
    expect(strip.find('[role=tablist]').exists()).toBe(true);
    // the root has no padding/gap on mobile: tabs are right under the header/tabs above
    expect(root.className).not.toMatch(/(^|\s)(p-4|gap-4)(\s|$)/);
    expect(strip.classes()).toEqual(expect.arrayContaining(['px-2', 'border-b']));
    expect(w.find('nav').exists()).toBe(false);
  });
});
