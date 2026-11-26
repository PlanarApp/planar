import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { json, mkUser, mockFetch } from './helpers';

// warm start: the screen doesn't wait for /me and /setup, both are revalidated in the background
async function boot(setup: object, me: Response, warm = true) {
  localStorage.setItem('planar.user', JSON.stringify(mkUser()));
  if (warm) localStorage.setItem('planar.warm', '1');
  localStorage.setItem('planar.setup', JSON.stringify(setup));
  vi.resetModules();
  const { router } = await import('../../router');
  const { useAuth } = await import('../useAuth');
  return { router, auth: useAuth(), me };
}

// cold transform of the router and Group screen graphs takes seconds under a full run — pay it in the hook, not in the first test
beforeAll(
  () => Promise.all([import('../../router'), import('../../screens/GroupScreen.vue')]),
  30_000,
);
beforeEach(() => localStorage.clear());

describe('auth:warm-start', () => {
  it('известный пользователь: user и ready сразу, переход не ждёт сеть', async () => {
    const { router, auth } = await boot({ needed: false }, json(200, {}));
    expect(auth.user.value?.login).toBe('ann');
    expect(auth.ready.value).toBe(true);
    mockFetch(() => new Promise<Response>(() => {}) as never); // the network hangs
    await router.push('/w');
    expect(router.currentRoute.value.path).toBe('/w/work');
  });
  it('401 из фона -> user null и /login', async () => {
    const { router, auth } = await boot({ needed: false }, json(401));
    mockFetch((m, p) =>
      p === '/api/auth/me' ? json(401, { code: 'unauthenticated', message: '' }) : json(200, {}),
    );
    await router.push('/w');
    await flushPromises();
    expect(auth.user.value).toBeNull();
    expect(router.currentRoute.value.path).toBe('/login');
  });
  it('свежий /setup с cloud.expired при кеше без него -> /paywall; кеш обновлён', async () => {
    const { router, auth } = await boot({ needed: false }, json(200, {}));
    const fresh = { needed: false, cloud: { status: 'expired', trialEndsAt: null, expired: true } };
    mockFetch((m, p) => (p === '/api/auth/me' ? json(200, { user: mkUser() }) : json(200, fresh)));
    await router.push('/w');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/paywall');
    expect(auth.lastSetupInfo.value?.cloud?.expired).toBe(true);
    expect(JSON.parse(localStorage.getItem('planar.setup')!).cloud.expired).toBe(true);
  });
  it('блокировка приложения или обязательная 2FA (нет флага warm): реплика не показывается до /me', async () => {
    const { auth } = await boot({ needed: false }, json(200, {}), false);
    expect(auth.user.value).toBeNull();
    expect(auth.ready.value).toBe(false);
  });
  it('/me с блокировкой при открытии снимает флаг warm', async () => {
    const { router } = await boot({ needed: false }, json(200, {}));
    mockFetch((m, p) =>
      p === '/api/auth/me'
        ? json(200, { user: mkUser(), lockOnOpen: true, lockMinutes: null })
        : json(200, { needed: false }),
    );
    await router.push('/w');
    await flushPromises();
    expect(localStorage.getItem('planar.warm')).toBeNull();
  });
});
