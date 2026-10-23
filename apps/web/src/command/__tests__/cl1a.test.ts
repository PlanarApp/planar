import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { reset } from '../../tasks/__tests__/data';

const { router } = vi.hoisted(() => ({ router: { current: undefined as never } }));
vi.mock('../../router', async () => {
  const vr = await import('vue-router');
  const stub = { template: '<div />' };
  const r = vr.createRouter({
    history: vr.createMemoryHistory(),
    routes: ['inbox', 'my', 'settings', 'doc'].map((n) => ({
      path: '/' + n,
      name: n,
      component: stub,
    })),
  });
  router.current = r as never;
  return { router: r };
});

const { registerModules, setEnabledModules } = await import('../../modules/registry');
const { ui } = await import('../hotkeys');
const { queryProviders, useProviderGroups, PROVIDER_DEBOUNCE_MS } = await import('../providers');
const CommandHost = (await import('../CommandHost.vue')).default;

const calls: [string, number][] = [];
const hit = (i: number) => ({ id: String(i), title: `Страница ${i}`, to: '/doc' });
registerModules([
  {
    id: 'cl1a-docs',
    search: [
      {
        id: 'pages',
        label: { ru: 'Страницы', en: 'Pages' },
        search: async (q, limit) => {
          calls.push([q, limit]);
          return Array.from({ length: 8 }, (_, i) => hit(i));
        },
      },
    ],
  },
  {
    id: 'cl1a-bad',
    search: [
      {
        id: 'x',
        label: 'Сломанные',
        search: async () => {
          throw new Error('boom');
        },
      },
    ],
  },
]);

const body = () => document.body.textContent ?? '';
let w: ReturnType<typeof mount>;
beforeEach(async () => {
  await reset();
  await setEnabledModules(['cl1a-docs', 'cl1a-bad']);
  calls.length = 0;
  await (router.current as { push: (p: string) => Promise<unknown> }).push('/my');
  w = mount(defineComponent({ components: { CommandHost }, render: () => h(CommandHost) }), {
    attachTo: document.body,
    global: {
      plugins: [router.current, createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })],
    },
  });
});
afterEach(() => {
  w.unmount();
  ui.palette = false;
});

describe('cl1a: поиск модулей в палитре', () => {
  it('cl1a: queryProviders — до 5 хитов, ошибка провайдера скрывает группу', async () => {
    const ok = {
      key: 'a:s',
      id: 's',
      label: 'Док',
      search: async () => Array.from({ length: 9 }, (_, i) => hit(i)),
    };
    const bad = {
      key: 'b:s',
      id: 's',
      label: 'Плохой',
      search: async () => Promise.reject(new Error('x')),
    };
    const empty = { key: 'c:s', id: 's', label: 'Пусто', search: async () => [] };
    const g = await queryProviders([ok, bad, empty], 'q', (l) => String(l));
    expect(g.map((x) => [x.label, x.hits.length])).toEqual([['Док', 5]]);
  });

  it('cl1a: debounce 150 мс — один запрос на последний ввод', async () => {
    vi.useFakeTimers();
    try {
      const q = ref('');
      const search = vi.fn(async () => [hit(1)]);
      const p = [{ key: 'm:s', id: 's', label: 'L', search }];
      const groups = useProviderGroups(q, () => p, String);
      q.value = 'a';
      await nextTick();
      q.value = 'ab';
      await nextTick();
      await vi.advanceTimersByTimeAsync(PROVIDER_DEBOUNCE_MS - 10);
      expect(search).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(20);
      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith('ab', 5);
      expect(groups.value.map((g) => g.label)).toEqual(['L']);
      q.value = '';
      await nextTick();
      expect(groups.value).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cl1a: палитра — группа провайдера под заголовком, выбор ведёт на to', async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    await vi.waitFor(() => expect(document.body.querySelector('input')).not.toBeNull(), {
      timeout: 5000,
    });
    const input = document.body.querySelector('input')!;
    input.value = 'зюзя';
    input.dispatchEvent(new Event('input'));
    await vi.waitFor(() => expect(body()).toContain('Страница 0'), { timeout: 5000 });
    expect(body()).toContain('Страницы');
    expect(body()).not.toContain('Сломанные');
    expect(body()).not.toContain('Страница 5');
    expect(calls.at(-1)).toEqual(['зюзя', 5]);
    document.body
      .querySelector('[role=listbox]')!
      .parentElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushPromises();
    expect(
      (router.current as { currentRoute: { value: { path: string } } }).currentRoute.value.path,
    ).toBe('/doc');
  });
});
