import 'fake-indexeddb/auto';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import ru from '../../i18n/ru';
import { syncState } from '../../sync';
import SyncStatus from '../SyncStatus.vue';

const i18n = createI18n({ legacy: false, locale: 'ru', messages: { ru } });
// in the app only the sync client changes the state; the test sets it itself
const set = (v: { status: string; pending: number }) =>
  ((syncState as { value: unknown }).value = v);
const state = (w: ReturnType<typeof mount>) => w.find('[data-testid=sync-status]');

describe('индикатор синхронизации', () => {
  it('офлайн с очередью → отправка → «синхронизировано»; в покое скрыт', async () => {
    set({ status: 'online', pending: 0 });
    const w = mount(SyncStatus, { global: { plugins: [i18n] } });
    expect(state(w).exists()).toBe(false);
    set({ status: 'offline', pending: 2 });
    await nextTick();
    expect(state(w).attributes('data-state')).toBe('offline');
    expect(state(w).text()).toContain('ждут отправки: 2');
    set({ status: 'online', pending: 2 });
    await nextTick();
    expect(state(w).attributes('data-state')).toBe('sync');
    set({ status: 'online', pending: 0 });
    await nextTick();
    expect(state(w).text()).toContain('Синхронизировано');
    set({ status: 'error', pending: 1 });
    await nextTick();
    expect(state(w).attributes('data-state')).toBe('error');
  });
});
