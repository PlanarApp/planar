import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginScreen from '../../screens/LoginScreen.vue';
import LockScreen from '../LockScreen.vue';
import { useAuth } from '../useAuth';
import { json, mkI18n, mkRouter, mkUser, mockFetch, resetAuth, stub } from './helpers';

beforeEach(resetAuth);

async function mountAt(comp: object, path: string) {
  const router = mkRouter([{ path: '/t/:k', component: stub }]);
  await router.push(path);
  await router.isReady();
  const w = mount(comp, { global: { plugins: [router, mkI18n()] }, attachTo: document.body });
  return { w, router };
}

describe('2FA: вход', () => {
  it('пароль → второй шаг → код → redirect', async () => {
    const f = mockFetch((m, p, b) => {
      if (p === '/api/auth/login') return json(200, { mfa: { totp: true, passkey: false } });
      if (p === '/api/auth/mfa/verify')
        return (b as { code: string }).code === '123456'
          ? json(200, { user: mkUser() })
          : json(401, { code: 'invalid_credentials', message: 'x' });
      if (p === '/api/auth/me') return json(200, { user: mkUser(), lockMinutes: 5 });
    });
    const { w, router } = await mountAt(LoginScreen, '/login?redirect=/t/PL-1');
    const inputs = w.findAll('input');
    await inputs[0]!.setValue('ann');
    await inputs[1]!.setValue('secret123');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(useAuth().user.value).toBeNull();
    expect(router.currentRoute.value.path).toBe('/login');

    await w.find('[data-testid=factor-code]').setValue('000000');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.text()).toContain('Неверный код');

    await w.find('[data-testid=factor-code]').setValue('123456');
    await w.find('form').trigger('submit');
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/t/PL-1'));
    expect(useAuth().user.value?.login).toBe('ann');
    expect(useAuth().lockPrefs.value.minutes).toBe(5);
    expect(f.mock.calls.map((c) => c[0])).toContain('/api/auth/mfa/verify');
  });
});

describe('2FA: блокировка', () => {
  it('код разблокирует', async () => {
    const a = useAuth();
    a.user.value = mkUser();
    a.locked.value = true;
    mockFetch((m, p) => {
      if (p === '/api/auth/security')
        return json(200, { totp: true, passkeys: [], recoveryLeft: 10 });
      if (p === '/api/auth/unlock') return json(204);
    });
    const { w } = await mountAt(LockScreen, '/');
    await flushPromises();
    expect(w.find('[data-testid=factor-passkey]').exists()).toBe(false);
    await w.find('[data-testid=factor-code]').setValue('123456');
    await w.find('form').trigger('submit');
    await vi.waitFor(() => expect(a.locked.value).toBe(false));
  });
});
