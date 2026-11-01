import { beforeEach, describe, expect, it, vi } from 'vitest';
import { router } from '../../router';
import { mkUser, resetAuth } from './helpers';
import { useAuth } from '../useAuth';

beforeEach(async () => {
  resetAuth();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  await router.replace('/login').catch(() => {});
  resetAuth();
});

describe('auth:offline', () => {
  it('офлайн с известным пользователем открывает защищённый маршрут', async () => {
    localStorage.setItem('planar.user', JSON.stringify(mkUser()));
    await router.push('/w');
    expect(router.currentRoute.value.path).toBe('/w/work');
    expect(useAuth().user.value?.login).toBe('ann');
  });
  it('офлайн без пользователя -> /login без исключения', async () => {
    await router.push('/w');
    expect(router.currentRoute.value.path).toBe('/login');
  });
});
