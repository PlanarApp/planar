import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import { useAuth, type User } from '../../../auth/useAuth';
import { registerModules, setEnabledModules } from '../../../modules/registry';
import * as sdk from '../../../modules/sdk';
import SettingsScreen from '../../SettingsScreen.vue';
import { i18n, setup, wait } from './setup';

setup();
const page = defineComponent({ render: () => h('p', { 'data-testid': 'mod-page' }, 'hello') });
registerModules([
  {
    id: 'import',
    settings: [{ id: 'import', label: 'Импорт', component: async () => ({ default: page }) }],
  },
  {
    id: 'wk12m',
    settings: [
      { id: 'open', label: 'Открытая', component: async () => ({ default: page }) },
      {
        id: 'adm',
        label: 'Админская',
        adminOnly: true,
        component: async () => ({ default: page }),
      },
    ],
  },
]);

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/settings/:section?', component: SettingsScreen }],
});

async function open(path: string, role: string) {
  useAuth().user.value = { id: 'u', role } as User;
  await router.push(path);
  document.body.innerHTML = '';
  const w = mount(SettingsScreen, { global: { plugins: [i18n, router] }, attachTo: document.body });
  await flushPromises();
  await wait();
  return w;
}

describe('wk12:', () => {
  it('wk12: страница модуля открывается по /settings/<id>:<page>', async () => {
    await setEnabledModules(['wk12m']);
    const w = await open('/settings/wk12m:open', 'member');
    expect(w.find('[data-testid=nav-wk12m\\:open]').exists()).toBe(true);
    expect(w.find('[data-testid=mod-page]').text()).toBe('hello');
  });
  it('wk12: adminOnly скрыта у member, видна админу', async () => {
    await setEnabledModules(['wk12m']);
    const m = await open('/settings/wk12m:adm', 'member');
    expect(m.find('[data-testid=nav-wk12m\\:adm]').exists()).toBe(false);
    expect(m.find('[data-testid=mod-page]').exists()).toBe(false);
    const a = await open('/settings/wk12m:adm', 'admin');
    expect(a.find('[data-testid=nav-wk12m\\:adm]').exists()).toBe(true);
    expect(a.find('[data-testid=mod-page]').exists()).toBe(true);
  });
  it('PLANARAPP-64: «О программе» — в самом низу, за разделителем после страниц модулей', async () => {
    await setEnabledModules(['wk12m']);
    const w = await open('/settings/wk12m:open', 'admin');
    const ids = w.findAll('nav > *').map((e) => e.attributes('data-testid'));
    expect(ids.slice(-3)).toEqual(['nav-wk12m:adm', 'nav-sep', 'nav-about']);
  });
  it('PLNRAPP-86: страница модуля «Импорт» — внутри «Импорт/Экспорт», отдельного пункта нет', async () => {
    await setEnabledModules(['import']);
    const w = await open('/settings/data', 'member');
    expect(w.find('[data-testid=nav-import\\:import]').exists()).toBe(false);
    expect(w.find('[data-testid=nav-data]').text()).toBe('Импорт/Экспорт');
    // the module page is an async component
    await vi.waitFor(() => expect(w.find('[data-testid=mod-page]').exists()).toBe(true));
    // not in the cloud and the import module is off — the section is empty and hidden
    await setEnabledModules([]);
    const off = await open('/settings/spaces', 'admin');
    expect(off.find('[data-testid=nav-data]').exists()).toBe(false);
    // the self-hosted owner — how to export on the server and upload to the cloud
    const own = await open('/settings/data', 'owner');
    expect(own.find('[data-testid=nav-data]').exists()).toBe(true);
    await vi.waitFor(() => expect(own.find('[data-testid=self-data]').exists()).toBe(true));
    expect(own.text()).toContain('./ops/backup.sh');
  });
  it('wk12: выключенный модуль — пункта нет', async () => {
    await setEnabledModules([]);
    const w = await open('/settings/spaces', 'admin');
    expect(w.find('[data-testid=nav-wk12m\\:open]').exists()).toBe(false);
  });
  it('wk12: SDK экспортирует FilterBuilder/useRouter/useCycles', () => {
    expect(sdk.FilterBuilder).toBeTruthy();
    expect(typeof sdk.useRouter).toBe('function');
    expect(typeof sdk.useCycles).toBe('function');
  });
});
