import 'fake-indexeddb/auto';
import { mount } from '@vue/test-utils';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { domainMutators } from '@planar/shared';
import en from '../../../i18n/en';
import ru from '../../../i18n/ru';
import { linkTasks } from '../../../links';
import { db, registerMutators, startSync, stopSync } from '../../../sync';
import { ids, reset, task, until } from '../../../tasks/__tests__/data';
import View from '../View.vue';

vi.mock('../..', async (orig) => ({ ...(await orig<object>()), openTask: vi.fn() }));

const i18n = createI18n({
  legacy: false,
  locale: 'ru',
  fallbackLocale: 'ru',
  messages: { ru, en },
});

beforeAll(() => registerMutators(domainMutators));
beforeEach(async () => {
  await stopSync();
  await reset();
  await startSync({
    userId: ids.ann,
    fetch: (() => Promise.reject(new TypeError('offline'))) as never,
  });
  await db._queue.clear();
});

describe('links-ui:board', () => {
  it('links-ui: Доска показывает BlockedIcon только у заблокированной', async () => {
    const [a, b] = [task(1), task(2)];
    await db.table('tasks').bulkPut([a, b]);
    await linkTasks(a.id, b.id, 'blocks');
    const w = mount(View, {
      props: {
        projectId: ids.project,
        options: {
          groupBy: 'status',
          sortBy: 'rank',
          sortDir: 'asc',
          showSubtasks: false,
          fields: ['status'],
        } as never,
      },
      global: { plugins: [i18n] },
    });
    await until(
      () => w.find(`[data-id="${b.id}"] [aria-label="Заблокирована"]`).exists() || undefined,
    );
    expect(w.find(`[data-id="${a.id}"] [aria-label="Заблокирована"]`).exists()).toBe(false);
  });
});
