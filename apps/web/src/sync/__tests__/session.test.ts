import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

const sync = vi.hoisted(() => ({
  startSync: vi.fn(async () => {}),
  stopSync: vi.fn(async () => {}),
  clearLocal: vi.fn(async () => {}),
  registerMutators: vi.fn(),
  moduleMutators: [],
  onUnauthorized: vi.fn(),
  syncState: { value: { status: 'online', pending: 0 } },
}));
vi.mock('..', () => sync);

import { json, mkUser, mockFetch, resetAuth } from '../../auth/__tests__/helpers';
import { useAuth } from '../../auth/useAuth';
import { initSession } from '../../session';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)*', component: { template: '<div/>' } }],
});
let fetchMock: ReturnType<typeof mockFetch>;

beforeEach(() => {
  vi.clearAllMocks();
  sync.syncState.value = { status: 'online', pending: 0 };
  resetAuth();
  fetchMock = mockFetch(() => json(200, {}));
});

describe('session:', () => {
  it('session: вход запускает startSync с userId, выход — stopSync', async () => {
    initSession(router);
    const { user } = useAuth();
    user.value = mkUser({ id: 'u1' });
    await nextTick();
    expect(sync.startSync).toHaveBeenCalledWith({ userId: 'u1' });
    user.value = null;
    await nextTick();
    expect(sync.stopSync).toHaveBeenCalled();
  });
  it('session: выход с пустой очередью очищает реплику', async () => {
    await useAuth().logout();
    expect(fetchMock).toHaveBeenCalled();
    expect(sync.clearLocal).toHaveBeenCalled();
  });
  it('session: выход с pending>0 без подтверждения не выполняется', async () => {
    sync.syncState.value = { status: 'offline', pending: 2 };
    const a = useAuth();
    const p = a.logout();
    await nextTick();
    expect(a.logoutPrompt.open.value).toBe(true);
    a.logoutPrompt.answer(false);
    await p;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sync.clearLocal).not.toHaveBeenCalled();
    const p2 = a.logout();
    a.logoutPrompt.answer(true);
    await p2;
    expect(sync.clearLocal).toHaveBeenCalled();
  });
  it('session: 401 — локально user=null и /login', async () => {
    initSession(router);
    const cb = sync.onUnauthorized.mock.calls.at(-1)![0] as () => void;
    useAuth().user.value = mkUser();
    cb();
    expect(useAuth().user.value).toBeNull();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/login'));
  });
});
