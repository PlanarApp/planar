import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileScreen from '../../screens/ProfileScreen.vue';
import { useAuth } from '../useAuth';
import { json, mkI18n, mkRouter, mkUser, mockFetch, resetAuth } from './helpers';

const sync = vi.hoisted(() => ({ state: { value: { status: 'online', pending: 0 } } }));
vi.mock('../../sync', () => ({ syncState: sync.state, clearLocal: async () => {} }));

beforeEach(() => {
  sync.state.value.pending = 0;
  resetAuth();
  useAuth().user.value = mkUser();
});

const mountProfile = () => mount(ProfileScreen, { global: { plugins: [mkRouter(), mkI18n()] } });
const pick = async (w: ReturnType<typeof mountProfile>) => {
  const input = w.find('input[type=file]');
  Object.defineProperty(input.element, 'files', {
    value: [new File(['x'], 'a.png', { type: 'image/png' })],
  });
  await input.trigger('change');
  await flushPromises();
};

describe('auth:avatar', () => {
  it('загрузка: POST /files, затем PATCH avatarFile', async () => {
    const f = vi.fn(async (p: string, ...[]: [RequestInit?]) =>
      p === '/files'
        ? json(201, { sha256: 'abc' })
        : json(200, { user: mkUser({ avatarFile: 'abc' }) }),
    );
    vi.stubGlobal('fetch', f);
    const w = mountProfile();
    await pick(w);
    expect(f.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
    expect(f.mock.calls[1][0]).toBe('/api/users/0190-u1');
    expect(JSON.parse(f.mock.calls[1][1]!.body as string)).toEqual({ avatarFile: 'abc' });
    expect(useAuth().user.value?.avatarFile).toBe('abc');
  });
  it('413: показывает ошибку, аватар не меняется', async () => {
    mockFetch(() => json(413, { code: 'payload_too_large', message: 'x' }));
    const w = mountProfile();
    await pick(w);
    expect(w.find('[role=alert]').exists()).toBe(true);
    expect(useAuth().user.value?.avatarFile).toBeNull();
  });
  it('убрать: PATCH avatarFile null', async () => {
    useAuth().user.value = mkUser({ avatarFile: 'abc' });
    const f = mockFetch(() => json(200, { user: mkUser() }));
    const w = mountProfile();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Убрать фото')!
      .trigger('click');
    await flushPromises();
    expect(JSON.parse(f.mock.calls[0][1]?.body as string)).toEqual({ avatarFile: null });
    expect(useAuth().user.value?.avatarFile).toBeNull();
  });
});

describe('auth:logout', () => {
  it('отмена подтверждения: false, запроса нет, user остаётся', async () => {
    sync.state.value.pending = 2;
    const f = mockFetch(() => json(204));
    const a = useAuth();
    const p = a.logout();
    a.logoutPrompt.answer(false);
    expect(await p).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(a.user.value).not.toBeNull();
  });
  it('нет сети: false, user остаётся', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const a = useAuth();
    expect(await a.logout()).toBe(false);
    expect(a.user.value).not.toBeNull();
  });
});
