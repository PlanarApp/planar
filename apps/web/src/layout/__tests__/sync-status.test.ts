import 'fake-indexeddb/auto';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import ru from '../../i18n/ru';
import { syncState } from '../../sync';
import SyncStatus from '../SyncStatus.vue';

const i18n = createI18n({ legacy: false, locale: 'ru', messages: { ru } });
const state = (w: ReturnType<typeof mount>) => w.find('[data-testid=sync-status]');

describe('индикатор синхронизации', () => {
  it('офлайн с очередью → отправка → «синхронизировано»; в покое скрыт', async () => {
    syncState.value = { status: 'online', pending: 0 };
    const w = mount(SyncStatus, { global: { plugins: [i18n] } });
    expect(state(w).exists()).toBe(false);
    syncState.value = { status: 'offline', pending: 2 };
    await nextTick();
    expect(state(w).attributes('data-state')).toBe('offline');
    expect(state(w).text()).toContain('ждут отправки: 2');
    syncState.value = { status: 'online', pending: 2 };
    await nextTick();
    expect(state(w).attributes('data-state')).toBe('sync');
    syncState.value = { status: 'online', pending: 0 };
    await nextTick();
    expect(state(w).text()).toContain('Синхронизировано');
    syncState.value = { status: 'error', pending: 1 };
    await nextTick();
    expect(state(w).attributes('data-state')).toBe('error');
  });
});
