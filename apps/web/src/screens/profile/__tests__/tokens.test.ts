import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileScreen from '../../ProfileScreen.vue';
import { useAuth } from '../../../auth/useAuth';
import {
  json,
  mkI18n,
  mkRouter,
  mkUser,
  mockFetch,
  resetAuth,
} from '../../../auth/__tests__/helpers';

vi.mock('../../../sync', () => ({
  syncState: { value: { status: 'online', pending: 0 } },
  clearLocal: async () => {},
}));

const tk = (o = {}) => ({
  id: 't1',
  name: 'CI',
  prefix: 'a1B2c3D4',
  scope: 'write',
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-10-23T06:00:00.000Z',
  ...o,
});
beforeEach(() => {
  resetAuth();
  useAuth().user.value = mkUser();
  document.body.innerHTML = '';
});
async function open(h: Parameters<typeof mockFetch>[0]) {
  const f = mockFetch(h);
  const w = mount(ProfileScreen, {
    global: { plugins: [mkRouter(), mkI18n()] },
    attachTo: document.body,
  });
  const d = w.find('details');
  (d.element as HTMLDetailsElement).open = true;
  await d.trigger('toggle');
  await flushPromises();
  return { w, f };
}

describe('tokens:', () => {
  it('tokens: профиль не грузит список до раскрытия', async () => {
    const f = mockFetch(() => json(200, { tokens: [] }));
    mount(ProfileScreen, { global: { plugins: [mkRouter(), mkI18n()] } });
    await flushPromises();
    expect(f).not.toHaveBeenCalled();
  });
  it('tokens: список показывает префикс и права', async () => {
    const { w } = await open(() => json(200, { tokens: [tk()] }));
    expect(w.find('[data-testid=token-row]').text()).toContain('plnr_a1B2c3D4');
  });
  it('tokens: выпуск шлёт POST и показывает секрет', async () => {
    const { w, f } = await open((m) =>
      m === 'POST' ? json(201, { token: tk(), secret: 'plnr_xyz' }) : json(200, { tokens: [] }),
    );
    await w.find('details input:not([type=radio])').setValue(' CI ');
    await w.find('details form').trigger('submit');
    await flushPromises();
    const post = f.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({
      name: 'CI',
      scope: 'read',
      expiresAt: null,
    });
    expect(w.find('[data-testid=secret]').text()).toBe('plnr_xyz');
    expect(w.findAll('[data-testid=token-row]')).toHaveLength(1);
  });
  it('tokens: пустое название — ошибка без запроса', async () => {
    const { w, f } = await open(() => json(200, { tokens: [] }));
    await w.find('details form').trigger('submit');
    expect(w.find('[role=alert]').exists()).toBe(true);
    expect(f.mock.calls.every((c) => c[1]?.method !== 'POST')).toBe(true);
  });
  it('tokens: копирование секрета', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { w } = await open((m) =>
      m === 'POST' ? json(201, { token: tk(), secret: 'plnr_xyz' }) : json(200, { tokens: [] }),
    );
    await w.find('details input:not([type=radio])').setValue('CI');
    await w.find('details form').trigger('submit');
    await flushPromises();
    await w.find('[data-testid=copy]').trigger('click');
    expect(writeText).toHaveBeenCalledWith('plnr_xyz');
  });
  it('tokens: отзыв после подтверждения шлёт DELETE и убирает строку', async () => {
    const { w, f } = await open((m) =>
      m === 'DELETE' ? json(204) : json(200, { tokens: [tk()] }),
    );
    await w.find('[data-testid=revoke]').trigger('click');
    await flushPromises();
    (document.body.querySelector('[data-testid=confirm]') as HTMLElement).click();
    await flushPromises();
    expect(f.mock.calls.some((c) => c[0] === '/api/tokens/t1' && c[1]?.method === 'DELETE')).toBe(
      true,
    );
    expect(w.findAll('[data-testid=token-row]')).toHaveLength(0);
  });
  it('tokens: инструкция MCP содержит URL /mcp', async () => {
    const { w } = await open(() => json(200, { tokens: [] }));
    expect(w.find('[data-testid=mcp-url]').text()).toMatch(/\/mcp$/);
    expect(w.find('[data-testid=mcp-config]').text()).toContain('/mcp');
  });
});
