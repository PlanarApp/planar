import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { TooltipProvider } from 'reka-ui';
import { defineComponent, h } from 'vue';
import { vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { domainMutators } from '@planar/shared';
import { useAuth } from '../../auth/useAuth';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { db, registerMutators, startSync, stopSync } from '../../sync';
import { ids, reset, task, until } from '../../tasks/__tests__/data';
import TaskPanel from '../TaskPanel.vue';

export { ids, task, until, db, flushPromises };

export const i18n = createI18n({
  legacy: false,
  locale: 'ru',
  fallbackLocale: 'ru',
  messages: { ru, en },
});

let registered = false;
/** fetch stub: handler(method, path) → [status, body]; default 500 (offline-like). */
export function stubFetch(h: (method: string, path: string) => [number, unknown?] | undefined) {
  const f = vi.fn(async (path: string, init?: RequestInit) => {
    const r = h(init?.method ?? 'GET', path) ?? [500, { code: 'internal', message: 'x' }];
    return new Response(r[1] === undefined ? null : JSON.stringify(r[1]), { status: r[0] });
  });
  vi.stubGlobal('fetch', f);
  return f;
}

/** Replica with a space, members, one task PLN-1; the current user is Ann. */
export async function setup(over: Record<string, unknown> = {}) {
  if (!registered) registerMutators(domainMutators);
  registered = true;
  await stopSync();
  await reset();
  await startSync({
    userId: ids.ann,
    fetch: (() => Promise.reject(new TypeError('offline'))) as never,
  });
  await db._queue.clear();
  const t = task(1, over);
  await db.table('tasks').put(t);
  const { user } = useAuth();
  user.value = (await db.table('users').get(ids.ann)) as never;
  stubFetch(() => undefined);
  return t;
}

export async function open(key = 'PLN-1') {
  const w = mount(
    defineComponent({
      render: () => h(TooltipProvider, null, () => h(TaskPanel, { taskKey: key, mode: 'panel' })),
    }),
    {
      global: { plugins: [i18n] },
      attachTo: document.body,
    },
  );
  await until(() => w.find('header').exists());
  await flushPromises();
  return w;
}

export const queued = async (name: string) =>
  (await db._queue.toArray()).filter((q) => q.name === name);

/** waits until an async condition becomes true (until accepts only a synchronous one). */
export async function eventually(f: () => Promise<unknown>, ms = 3000) {
  const t0 = Date.now();
  while (!(await f())) {
    if (Date.now() - t0 > ms) throw new Error('eventually: таймаут');
    await new Promise((r) => setTimeout(r, 10));
  }
}
