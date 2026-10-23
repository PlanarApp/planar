import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { reset, task, until } from '../../tasks/__tests__/data';
import { db } from '../../sync';

const { router } = vi.hoisted(() => ({ router: { current: undefined as never } }));
vi.mock('../../router', async () => {
  const vr = await import('vue-router');
  const stub = { template: '<div />' };
  const r = vr.createRouter({
    history: vr.createMemoryHistory(),
    routes: ['inbox', 'my', 'settings'].map((n) => ({ path: '/' + n, name: n, component: stub })),
  });
  router.current = r as never;
  return { router: r };
});

const { registerModules } = await import('../../modules/registry');
const { ui, hotkeys } = await import('../hotkeys');
const CommandHost = (await import('../CommandHost.vue')).default;

const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
const body = () => document.body.textContent ?? '';
let w: ReturnType<typeof mount>;
const run = vi.fn();

beforeEach(async () => {
  await reset();
  await db.table('tasks').put(task(7, { title: 'Найди меня' }));
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
  ui.palette = ui.cheat = false;
  expect(hotkeys).toHaveLength(0);
});

const ready = (s: string) => until(() => body().includes(s));
const typeIn = async (q: string) => {
  const input = document.body.querySelector('input')!;
  input.value = q;
  input.dispatchEvent(new Event('input'));
  await flushPromises();
};

describe('cmd:palette', () => {
  it('открывается по Cmd+K и закрывается по повторному', async () => {
    key('k', { metaKey: true });
    await ready('Мои задачи');
    key('k', { ctrlKey: true });
    await flushPromises();
    expect(ui.palette).toBe(false);
  });
  it('ввод фильтрует команды, Enter выполняет', async () => {
    key('k', { ctrlKey: true });
    await ready('Настройки');
    await typeIn('входящ');
    expect(body()).not.toContain('Настройки');
    document.body
      .querySelector('[role=listbox]')!
      .parentElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushPromises();
    expect(
      (router.current as { currentRoute: { value: { path: string } } }).currentRoute.value.path,
    ).toBe('/inbox');
    expect(ui.palette).toBe(false);
  });
  it('команда модуля с when', async () => {
    registerModules([
      {
        id: 'm',
        commands: [
          { id: 'yes', label: { ru: 'Модуль да', en: 'Yes' }, run },
          { id: 'no', label: { ru: 'Модуль нет', en: 'No' }, when: () => false, run },
        ],
      } as never,
    ]);
    key('k', { ctrlKey: true });
    await ready('Модуль да');
    expect(body()).not.toContain('Модуль нет');
  });
  it('находит задачу по названию', async () => {
    key('/');
    await ready('Мои задачи');
    await typeIn('найди');
    await ready('PLN-7');
  });
});

describe('cmd:hotkeys', () => {
  it('не срабатывает в поле ввода', async () => {
    const input = document.createElement('input');
    document.body.append(input);
    key('?', {}, input);
    await flushPromises();
    expect(ui.cheat).toBe(false);
    key('g', {}, input);
    key('i', {}, input);
    await flushPromises();
    expect(
      (router.current as { currentRoute: { value: { path: string } } }).currentRoute.value.path,
    ).toBe('/my');
    input.remove();
  });
  it('последовательность g i', async () => {
    key('g');
    key('i');
    await flushPromises();
    expect(
      (router.current as { currentRoute: { value: { path: string } } }).currentRoute.value.path,
    ).toBe('/inbox');
  });
  it('? открывает шпаргалку', async () => {
    key('?');
    await ready('Горячие клавиши');
  });
});
