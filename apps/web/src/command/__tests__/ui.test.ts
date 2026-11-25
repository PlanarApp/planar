import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { domainMutators } from '@planar/shared';
import { ids, reset, task, until } from '../../tasks/__tests__/data';
import { db, registerMutators, startSync, stopSync } from '../../sync';
import { updateTask } from '../../tasks';

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
const { ui, hotkeys, quickCreate } = await import('../hotkeys');
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
    await ready('Мой день');
    key('k', { ctrlKey: true });
    await flushPromises();
    expect(ui.palette).toBe(false);
  });
  it('ввод фильтрует команды, Enter выполняет', async () => {
    key('k', { ctrlKey: true });
    await ready('Мой день');
    await typeIn('входящ');
    expect(body()).not.toContain('Мой день');
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
    await ready('Мой день');
    await typeIn('найди');
    await ready('PLN-7');
  });
});

describe('cmd:live', () => {
  it('polish: cmd:live результаты «Задачи» обновляются при изменении реплики', async () => {
    // the index follows replica events (PLNRAPP-251) — edits go through the sync client
    registerMutators(domainMutators);
    await startSync({
      userId: ids.ann,
      fetch: (() => Promise.reject(new TypeError('offline'))) as never,
    });
    const hidden = task(8, { title: 'Скрыта' });
    await db.table('tasks').put(hidden);
    key('k', { ctrlKey: true });
    await ready('Мой день');
    await typeIn('найди');
    await ready('PLN-7');
    await updateTask(hidden.id, { title: 'Найди ещё' });
    await ready('PLN-8');
    const seven = (await db
      .table('tasks')
      .filter((t) => t.number === 7)
      .first())!;
    await updateTask(seven.id, { title: 'Другое' });
    await until(() => !body().includes('PLN-7') || undefined);
    await stopSync();
  });
});

describe('cmd:hotkeys', () => {
  it('polish: cmd:hotkeys работают по e.code на русской раскладке', async () => {
    key('Б', { code: 'Slash', shiftKey: true, key: '?' });
    await ready('Горячие клавиши');
    ui.cheat = false;
    key('п', { code: 'KeyG' });
    key('ш', { code: 'KeyI' });
    await flushPromises();
    expect(
      (router.current as { currentRoute: { value: { path: string } } }).currentRoute.value.path,
    ).toBe('/inbox');
    key('л', { code: 'KeyK', metaKey: true });
    await ready('Мой день');
  });
  it('PLNRAPP-88: «/» на русской раскладке (клавиша Slash даёт «.») открывает поиск', async () => {
    key('.', { code: 'Slash' });
    await ready('Мой день');
  });
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
  it('PLANARAPP-40 не срабатывает в поле внутри shadow DOM (поиск эмодзи)', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const input = document.createElement('input');
    host.attachShadow({ mode: 'open' }).append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, composed: true }));
    await flushPromises();
    expect(ui.cheat).toBe(false);
    host.remove();
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

describe('cmd:quick-create — описание (PLNRAPP-683)', () => {
  const desc = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Из выделения' }] }],
  };
  const q = <T extends Element = HTMLElement>(s: string) => document.body.querySelector<T>(s);
  const submit = async () => {
    await until(
      () =>
        !q<HTMLButtonElement>('[data-testid=quick-submit]')?.disabled && body().includes('Todo'),
    );
    q('#quick-create')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await until(() => !ui.create);
  };
  const created = async () => {
    const all = await db.table('tasks').toArray();
    return all.find((x) => x.title === 'Новая');
  };
  const setTitle = async () => {
    const input = q<HTMLInputElement>('[data-testid=quick-title]')!;
    input.value = 'Новая';
    input.dispatchEvent(new Event('input'));
    await flushPromises();
  };
  beforeEach(async () => {
    try {
      registerMutators(domainMutators);
    } catch {
      /* already registered by cmd:live */
    }
    await stopSync();
    await startSync({
      userId: ids.ann,
      fetch: (() => Promise.reject(new TypeError('offline'))) as never,
    });
  });
  afterEach(async () => {
    ui.create = false;
    await stopSync();
  });

  it('по умолчанию поле свёрнуто под «+ Описание», задача создаётся без описания', async () => {
    quickCreate(ids.project);
    await until(() => !!q('[data-testid=quick-description-toggle]'));
    expect(q('[data-testid=quick-description-toggle]')!.textContent).toContain('Описание');
    expect(q('[data-testid=quick-description]')).toBeNull();
    await setTitle();
    await submit();
    const t = await created();
    expect(t).toBeTruthy();
    expect(t.description).toBeNull();
  });
  it('«+ Описание» разворачивает редактор без вложений', async () => {
    quickCreate(ids.project);
    await until(() => !!q('[data-testid=quick-description-toggle]'));
    q<HTMLButtonElement>('[data-testid=quick-description-toggle]')!.click();
    await until(() => !!q('[data-testid=quick-description] .ProseMirror'));
    expect(q('[data-testid=quick-description] input[type=file]')).toBeNull();
  });
  it('начальное описание и флаг «развёрнуто» — текст сохраняется в задачу', async () => {
    quickCreate(ids.project, { description: desc, descriptionOpen: true });
    await until(() => !!q('[data-testid=quick-description] .ProseMirror'));
    expect(q('[data-testid=quick-description]')!.textContent).toContain('Из выделения');
    await setTitle();
    await submit();
    const t = await created();
    expect(t.description).toEqual(desc);
  });
  it('начальное описание без флага — поле свёрнуто, описание всё равно сохраняется', async () => {
    quickCreate(ids.project, { description: desc });
    await until(() => !!q('[data-testid=quick-description-toggle]'));
    expect(q('[data-testid=quick-description]')).toBeNull();
    await setTitle();
    await submit();
    expect((await created()).description).toEqual(desc);
  });
});

describe('cmd:quick-create — из выделения (PLNRAPP-684)', () => {
  const q = <T extends Element = HTMLElement>(s: string) => document.body.querySelector<T>(s);
  const submit = async () => {
    await until(
      () =>
        !q<HTMLButtonElement>('[data-testid=quick-submit]')?.disabled && body().includes('Todo'),
    );
    q('#quick-create')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await until(() => !ui.create);
  };
  const path = () =>
    (router.current as { currentRoute: { value: { path: string } } }).currentRoute.value.path;
  beforeEach(async () => {
    try {
      registerMutators(domainMutators);
    } catch {
      /* already registered */
    }
    await stopSync();
    await startSync({
      userId: ids.ann,
      fetch: (() => Promise.reject(new TypeError('offline'))) as never,
    });
  });
  afterEach(async () => {
    ui.create = false;
    await stopSync();
  });

  it('имя из выделения; задача в выбранном проекте (текущий по умолчанию); onCreated вместо перехода', async () => {
    const done = vi.fn();
    quickCreate(ids.project, { title: 'Из выделения', onCreated: done });
    await until(() => q<HTMLInputElement>('[data-testid=quick-title]')?.value === 'Из выделения');
    expect(q('[data-testid=quick-parent]')).toBeNull();
    expect(q('[aria-label="Проект"]')).toBeTruthy();
    await submit();
    const t = (await db.table('tasks').toArray()).find((x) => x.title === 'Из выделения');
    expect(t).toBeTruthy();
    expect(t.projectId).toBe(ids.project);
    expect(t.parentId).toBeNull();
    expect(done).toHaveBeenCalledWith(t.id);
    expect(path()).toBe('/my');
  });
  it('подзадача: под родителем в его проекте, проект не выбирается', async () => {
    const parent = task(8, { title: 'Родитель' });
    await db.table('tasks').put(parent);
    const done = vi.fn();
    quickCreate('', {
      title: 'Подзадача',
      parent: { id: parent.id, title: parent.title, projectId: parent.projectId },
      onCreated: done,
    });
    await until(() => !!q('[data-testid=quick-parent]'));
    expect(q('[data-testid=quick-parent]')!.textContent).toContain('Родитель');
    expect(body()).toContain('Новая подзадача');
    expect(q('[aria-label="Проект"]')).toBeNull();
    await submit();
    const sub = (await db.table('tasks').toArray()).find((x) => x.title === 'Подзадача');
    expect(sub.parentId).toBe(parent.id);
    expect(sub.projectId).toBe(parent.projectId);
    expect(done).toHaveBeenCalledWith(sub.id);
  });
  it('обычное открытие после создания из выделения — без имени и родителя', async () => {
    quickCreate(ids.project, {
      title: 'X',
      parent: { id: 'p', title: 'P', projectId: ids.project },
    });
    ui.create = false;
    quickCreate(ids.project);
    expect(ui.createTitle).toBe('');
    expect(ui.createParent).toBeNull();
    expect(ui.createDone).toBeNull();
  });
});
