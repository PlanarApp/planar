import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { router } from '../../router';
import { useAuth } from '../../auth/useAuth';
import { json, mkUser, mockFetch } from '../../auth/__tests__/helpers';
import { setEnabledModules, setModuleLoaders } from '../registry';

const Page = { render: () => null };

describe('wk15:', () => {
  beforeEach(() => {
    mockFetch((_m, p) => (p === '/api/auth/me' ? json(200, { user: mkUser() }) : undefined));
    useAuth().user.value = mkUser();
  });
  it('wk15: прямой переход на /m/<mod>/page грузит модуль и открывает его страницу', async () => {
    setModuleLoaders({
      '../../../../modules/wk15m/web/index.ts': async () => ({
        web: { id: 'wk15m', routes: [{ path: '/m/wk15m/page', component: Page }] },
      }),
    });
    await setEnabledModules(['wk15m']); // холодная реплика ждала бы настройки
    await router.push('/m/wk15m/page');
    const r = router.currentRoute.value;
    expect(r.path).toBe('/m/wk15m/page');
    expect(r.matched.at(-1)?.components?.default).toBe(Page);
  });
  it('wk15: выключенный модуль — заглушка', async () => {
    setModuleLoaders({
      '../../../../modules/wk15off/web/index.ts': async () => ({
        web: { id: 'wk15off', routes: [{ path: '/m/wk15off/page', component: Page }] },
      }),
    });
    await setEnabledModules([]);
    await router.push('/m/wk15off/page');
    expect(router.currentRoute.value.name).toBe('module');
  });
});
