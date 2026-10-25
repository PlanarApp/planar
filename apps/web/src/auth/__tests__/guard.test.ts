import { beforeEach, describe, expect, it } from 'vitest';
import { router } from '../../router';
import { json, mkUser, mockFetch, resetAuth } from './helpers';
import { useAuth } from '../useAuth';

beforeEach(async () => {
  resetAuth();
  mockFetch((m, p) =>
    p === '/api/setup'
      ? json(200, { needed: false })
      : json(401, { code: 'unauthenticated', message: '' }),
  );
  await router.replace('/login').catch(() => {});
});

describe('auth:guard-login', () => {
  it('нет сессии -> /login?redirect=', async () => {
    mockFetch((m, p) =>
      p === '/api/auth/me'
        ? json(401, { code: 'unauthenticated', message: '' })
        : p === '/api/setup'
          ? json(200, { needed: false })
          : undefined,
    );
    await router.push('/t/PL-1');
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.redirect).toBe('/t/PL-1');
  });
  it('сессия есть: /login -> /', async () => {
    mockFetch((m, p) => (p === '/api/auth/me' ? json(200, { user: mkUser() }) : undefined));
    useAuth().user.value = mkUser();
    await router.push('/inbox');
    await router.push('/login');
    expect(router.currentRoute.value.path).toBe('/w');
    expect(useAuth().user.value?.login).toBe('ann');
  });
});

describe('auth:guard-setup', () => {
  it('needed:true -> /setup', async () => {
    mockFetch((m, p) =>
      p === '/api/auth/me'
        ? json(401, { code: 'unauthenticated', message: '' })
        : p === '/api/setup'
          ? json(200, { needed: true })
          : undefined,
    );
    await router.push('/my');
    expect(router.currentRoute.value.path).toBe('/setup');
  });
  it('needed:false: /setup -> /login', async () => {
    mockFetch((m, p) =>
      p === '/api/auth/me'
        ? json(401, { code: 'unauthenticated', message: '' })
        : json(200, { needed: false }),
    );
    await router.push('/setup');
    expect(router.currentRoute.value.path).toBe('/login');
  });
});
