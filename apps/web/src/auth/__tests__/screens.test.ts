import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import LoginScreen from '../../screens/LoginScreen.vue';
import SetupScreen from '../../screens/SetupScreen.vue';
import ProfileScreen from '../../screens/ProfileScreen.vue';
import SettingsScreen from '../../screens/SettingsScreen.vue';
import { useAuth } from '../useAuth';
import { json, mkI18n, mkRouter, mkUser, mockFetch, resetAuth, stub } from './helpers';

beforeEach(resetAuth);

async function mountAt(comp: object, path: string) {
  const router = mkRouter([
    { path: '/setup', component: stub },
    { path: '/profile', component: comp },
    { path: '/settings/:section?', component: comp },
    { path: '/t/:k', component: stub },
  ]);
  await router.push(path);
  await router.isReady();
  const w = mount(comp, { global: { plugins: [router, mkI18n()] }, attachTo: document.body });
  return { w, router };
}
const fill = async (w: ReturnType<typeof mount>, vals: string[]) => {
  const inputs = w.findAll('input:not([type=file])');
  for (let i = 0; i < vals.length; i++) await inputs[i].setValue(vals[i]);
};

describe('auth:login', () => {
  it('успех -> redirect', async () => {
    mockFetch((m, p) => (p === '/api/auth/login' ? json(200, { user: mkUser() }) : undefined));
    const { w, router } = await mountAt(LoginScreen, '/login?redirect=/t/PL-1');
    await fill(w, ['ann', 'secret123']);
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/t/PL-1');
    expect(useAuth().user.value?.login).toBe('ann');
  });
  it('invalid_credentials', async () => {
    mockFetch(() => json(401, { code: 'invalid_credentials', message: 'x' }));
    const { w } = await mountAt(LoginScreen, '/login');
    await fill(w, ['ann', 'bad']);
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.text()).toContain('Неверный логин или пароль');
  });
  it('rate_limited', async () => {
    mockFetch(() => json(429, { code: 'rate_limited', message: 'x' }));
    const { w } = await mountAt(LoginScreen, '/login');
    await fill(w, ['ann', 'bad']);
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.text()).toContain('Слишком много попыток');
  });
});

describe('auth:setup', () => {
  it('короткий пароль не отправляется', async () => {
    const f = mockFetch(() => undefined);
    const { w } = await mountAt(SetupScreen, '/setup');
    await fill(w, ['ann', 'Ann', 'short', 'short']);
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(f).not.toHaveBeenCalled();
    expect(w.text()).toContain('Не короче 8');
  });
  it('успех -> вход', async () => {
    const f = mockFetch((m, p) =>
      p === '/api/setup'
        ? json(201, { user: mkUser() })
        : p === '/api/auth/login'
          ? json(200, { user: mkUser() })
          : undefined,
    );
    const { w, router } = await mountAt(SetupScreen, '/setup');
    await fill(w, ['ann', 'Ann', 'password1', 'password1']);
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(f.mock.calls.map((c) => c[0])).toEqual(['/api/setup', '/api/auth/login']);
    expect(useAuth().user.value?.login).toBe('ann');
    expect(router.currentRoute.value.path).toBe('/');
  });
});

describe('auth:profile', () => {
  it('PATCH имени', async () => {
    useAuth().user.value = mkUser();
    let body: unknown;
    mockFetch((m, p, b) => {
      body = b;
      return m === 'PATCH' && p === '/api/users/0190-u1'
        ? json(200, { user: mkUser({ name: 'Bob' }) })
        : undefined;
    });
    const { w } = await mountAt(ProfileScreen, '/profile');
    await fill(w, ['Bob']);
    await w.findAll('form')[0].trigger('submit');
    await flushPromises();
    expect(body).toMatchObject({ name: 'Bob' });
    expect(useAuth().user.value?.name).toBe('Bob');
  });
  it('тема и язык', async () => {
    useAuth().user.value = mkUser();
    const { setLocale } = await import('../../i18n');
    const { useTheme } = await import('../../ui');
    useTheme().theme.value = 'dark';
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    setLocale('en');
    expect(localStorage.getItem('planar.locale')).toBe('en');
    setLocale('ru');
  });
});

describe('auth:admin-users', () => {
  const users = [mkUser(), mkUser({ id: 'u2', login: 'bob', name: 'Bob', role: 'member' })];
  const h = (calls: string[]) => (m: string, p: string, b: unknown) => {
    calls.push(`${m} ${p} ${JSON.stringify(b)}`);
    if (m === 'GET' && p === '/api/users') return json(200, { users });
    if (m === 'POST' && p === '/api/users')
      return json(201, { user: mkUser({ id: 'u3', login: 'cy', name: 'Cy', role: 'member' }) });
    if (m === 'PATCH' && p === '/api/users/u2')
      return json(200, { user: { ...users[1], deactivatedAt: 5 } });
    return undefined;
  };
  it('список, блокировка', async () => {
    useAuth().user.value = mkUser();
    const calls: string[] = [];
    mockFetch(h(calls));
    const { w } = await mountAt(SettingsScreen, '/settings/users');
    await flushPromises();
    expect(w.findAll('[data-testid=user-row]')).toHaveLength(2);
    await w.findAll('[data-testid=toggle-block]')[0].trigger('click');
    await flushPromises();
    expect(calls).toContain('PATCH /api/users/u2 {"deactivated":true}');
  });
  it('создание', async () => {
    useAuth().user.value = mkUser();
    const calls: string[] = [];
    mockFetch(h(calls));
    const { w } = await mountAt(SettingsScreen, '/settings/users');
    await flushPromises();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Добавить пользователя')!
      .trigger('click');
    await flushPromises();
    const form = document.querySelector('#user-form')!;
    const ins = form.querySelectorAll('input');
    for (const [i, v] of ['cy', 'Cy', 'password1'].entries()) {
      ins[i].value = v;
      ins[i].dispatchEvent(new Event('input'));
    }
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();
    expect(
      calls.some((c) =>
        c.startsWith(
          'POST /api/users {"login":"cy","name":"Cy","password":"password1","role":"member"',
        ),
      ),
    ).toBe(true);
    expect(w.findAll('[data-testid=user-row]')).toHaveLength(3);
  });
  it('не-админ не видит раздел', async () => {
    useAuth().user.value = mkUser({ role: 'member' });
    const f = mockFetch(() => undefined);
    const { w } = await mountAt(SettingsScreen, '/settings/users');
    await flushPromises();
    expect(w.find('[data-testid=nav-users]').exists()).toBe(false);
    expect(w.find('[data-testid=user-row]').exists()).toBe(false);
    // профиль (куда ведёт редирект) сам грузит токены; список пользователей — нет
    expect(f.mock.calls.map((c) => c[0])).not.toContain('/api/users');
  });
});
