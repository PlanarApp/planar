// PLNRAPP-709: the «My day» tab of «My work» — only the planner by dueDate, no task list (view) under it
import 'fake-indexeddb/auto';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import { TooltipProvider } from 'reka-ui';
import { domainMutators, uuidv7 } from '@planar/shared';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { db, registerMutators, startSync, stopSync } from '../../sync';
import { useAuth } from '../../auth/useAuth';
import { mkUser } from '../../auth/__tests__/helpers';

// every view is a stub: the test only checks whether a view is drawn
vi.mock('../../views/open', async (orig) => {
  const o = await orig<typeof import('../../views/open')>();
  const stub = {
    __esModule: true,
    default: { setup: () => () => h('div', { 'data-testid': 'view-stub' }) },
  };
  return {
    ...o,
    viewLoaders: () =>
      Object.fromEntries(Object.keys(o.viewLoaders()).map((k) => [k, async () => stub])),
  };
});

const ScopeTasks = (await import('../../views/ScopeTasks.vue')).default;

const i18n = createI18n({
  legacy: false,
  locale: 'ru',
  fallbackLocale: 'ru',
  messages: { ru, en },
});
const me = uuidv7();
const space = uuidv7();
const project = uuidv7();

beforeAll(() => registerMutators(domainMutators));
enableAutoUnmount(afterEach);
beforeEach(async () => {
  await stopSync();
  for (const t of db.tables) await t.clear();
  localStorage.clear();
  useAuth().user.value = mkUser({ id: me });
  await startSync({ userId: me, fetch: (() => Promise.reject(new TypeError('offline'))) as never });
  await db.table('spaces').put({ id: space, name: 'S', rank: 'a0' });
  await db.table('projects').put({ id: project, spaceId: space, key: 'PL', name: 'P', rank: 'a0' });
});

const show = (props: Record<string, unknown>) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:p(.*)*', component: { render: () => null } }],
  });
  return mount(
    defineComponent({
      render: () =>
        h(TooltipProvider, null, () =>
          h(
            ScopeTasks,
            { spaceId: space, ...props },
            { tabs: () => h('i', { 'data-testid': 'tabs' }) },
          ),
        ),
    }),
    { global: { plugins: [i18n, router] } },
  );
};

describe('PLNRAPP-709 вкладка «Мой день»', () => {
  it('под планировщиком нет списка задач; табы разделов на месте, переключателя видов нет', async () => {
    const w = show({ day: true });
    await vi.waitFor(() => expect(w.find('[data-testid=my-day]').exists()).toBe(true));
    await flushPromises();
    expect(w.find('[data-testid=view-stub]').exists()).toBe(false);
    expect(w.find('[data-testid=view-layout]').exists()).toBe(false);
    expect(w.find('[data-testid=tabs]').exists()).toBe(true);
  });

  it('раздел с Me Mode («Назначенные») по-прежнему рисует вид', async () => {
    const w = show({ me: 'assigned' });
    await vi.waitFor(() => expect(w.find('[data-testid=view-stub]').exists()).toBe(true));
    expect(w.find('[data-testid=my-day]').exists()).toBe(false);
  });
});
