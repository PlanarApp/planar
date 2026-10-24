import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, type Component } from 'vue';
import { TooltipProvider } from 'reka-ui';
import { Plus } from 'lucide-vue-next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import ru from '../i18n/ru';
import en from '../i18n/en';
import {
  AvatarStack,
  Button,
  Chip,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Kbd,
  Menu,
  Select,
  Tooltip,
  resetBreakpoint,
  Popover,
  Tabs,
  Toolbar,
  type MenuItem,
} from './index';

const i18n = createI18n({ legacy: false, locale: 'ru', messages: { ru, en } });
const wrap = (c: Component, props: Record<string, unknown> = {}, slots = {}) =>
  mount(
    defineComponent({
      render: () => h(TooltipProvider, null, () => h(c, props, slots)),
    }),
    { attachTo: document.body, global: { plugins: [i18n] } },
  );
const $ = (s: string) => document.body.querySelector<HTMLElement>(s);
const press = (el: Element, key: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Button / IconButton', () => {
  it('loading → aria-busy и disabled', () => {
    const w = wrap(Button, { loading: true });
    const b = w.find('button').element;
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.disabled).toBe(true);
  });
  it('danger-ghost — текст danger', () => {
    const w = wrap(Button, { variant: 'danger-ghost' });
    expect(w.find('button').classes()).toContain('text-danger');
  });
  it('iconRight рисует иконку после текста', () => {
    const w = wrap(Button, { iconRight: Plus }, { default: () => 'x' });
    expect(w.find('button').element.lastElementChild?.tagName).toBe('svg');
  });
  it('IconButton: aria-label и aria-pressed', () => {
    const w = wrap(IconButton, { icon: Plus, label: 'Добавить', active: false });
    expect(w.find('button').element.getAttribute('aria-label')).toBe('Добавить');
    expect(w.find('button').element.getAttribute('aria-pressed')).toBe('false');
    const w2 = wrap(IconButton, { icon: Plus, label: 'A', active: true });
    expect(w2.find('button').element.getAttribute('aria-pressed')).toBe('true');
  });
  it('IconButton без active — без aria-pressed', () => {
    const w = wrap(IconButton, { icon: Plus, label: 'A' });
    expect(w.find('button').element.hasAttribute('aria-pressed')).toBe(false);
  });
});

describe('IconButton как trigger', () => {
  const trigger = () => h(IconButton, { icon: Plus, label: 'Ещё' });
  it('trigger Menu: открывается с клавиатуры, aria на той же кнопке', async () => {
    const w = wrap(Menu, { items: [{ id: 'a', label: 'Пункт', onSelect: () => {} }] }, { trigger });
    const b = w.find('button').element;
    expect(b.getAttribute('aria-label')).toBe('Ещё');
    press(b, 'Enter');
    await flushPromises();
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect($('[role="menuitem"]')).not.toBeNull();
    w.unmount();
  });
  it('trigger Popover: открывается кликом', async () => {
    const w = wrap(Popover, {}, { trigger, default: () => 'Тело' });
    const b = w.find('button').element;
    b.click();
    await flushPromises();
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(b.getAttribute('aria-label')).toBe('Ещё');
    expect(document.body.textContent).toContain('Тело');
    w.unmount();
  });
});

describe('ConfirmDialog', () => {
  const open = (extra: Record<string, unknown> = {}) => {
    const onConfirm = vi.fn();
    const onUpdate = vi.fn();
    wrap(ConfirmDialog, {
      open: true,
      title: 'Удалить?',
      confirmLabel: 'Удалить',
      onConfirm,
      'onUpdate:open': onUpdate,
      ...extra,
    });
    return { onConfirm, onUpdate };
  };
  const btn = (text: string) =>
    [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

  it('фокус на «Отмена», подпись по умолчанию из i18n', async () => {
    open();
    await flushPromises();
    await nextTick();
    expect(document.activeElement).toBe(btn('Отмена'));
  });
  it('confirm — только по кнопке, затем закрытие', async () => {
    const { onConfirm, onUpdate } = open();
    await flushPromises();
    expect(onConfirm).not.toHaveBeenCalled();
    btn('Удалить').click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(false);
  });
  it('Esc закрывает без confirm', async () => {
    const { onConfirm, onUpdate } = open();
    await flushPromises();
    press($('[role="dialog"]')!, 'Escape');
    await flushPromises();
    expect(onUpdate).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it('«Отмена» закрывает без confirm', async () => {
    const { onConfirm, onUpdate } = open();
    await flushPromises();
    btn('Отмена').click();
    expect(onUpdate).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('Menu.confirm', () => {
  it('onSelect — только после подтверждения', async () => {
    const onSelect = vi.fn();
    const items: MenuItem[] = [
      {
        id: 'd',
        label: 'Удалить',
        danger: true,
        confirm: { title: 'Точно?', confirmLabel: 'Да, удалить' },
        onSelect,
      },
    ];
    const w = wrap(Menu, { items }, { trigger: () => h('button', { id: 'tr' }, 'o') });
    const tr = w.find('#tr').element;
    press(tr, 'Enter');
    await flushPromises();
    const item = $('[role="menuitem"]')!;
    expect(item.className).toContain('text-danger');
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    expect(onSelect).not.toHaveBeenCalled();
    const ok = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Да, удалить',
    )!;
    ok.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('Tabs', () => {
  it('роли и aria-selected; Enter выбирает, стрелка только двигает фокус', async () => {
    const onUpdate = vi.fn();
    const w = wrap(Tabs, {
      label: 'Вид',
      modelValue: 'a',
      'onUpdate:modelValue': onUpdate,
      items: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    });
    expect(w.find('[role="tablist"]').attributes('aria-label')).toBe('Вид');
    const tabs = w.findAll('[role="tab"]');
    expect(tabs.map((t) => t.attributes('aria-selected'))).toEqual(['true', 'false']);
    await flushPromises();
    (tabs[0].element as HTMLElement).focus();
    press(tabs[0].element, 'ArrowRight');
    await flushPromises();
    expect(document.activeElement).toBe(tabs[1].element);
    expect(onUpdate).not.toHaveBeenCalled();
    press(tabs[1].element, 'Enter');
    await nextTick();
    expect(onUpdate).toHaveBeenCalledWith('b');
  });
});

describe('Chip / AvatarStack / Kbd / EmptyState / Toolbar', () => {
  it('Chip removable: кнопка с aria-label, событие remove', async () => {
    const onRemove = vi.fn();
    const w = wrap(
      Chip,
      { removable: true, removeLabel: 'Убрать', onRemove },
      { default: () => 'x' },
    );
    const b = w.find('button');
    expect(b.attributes('aria-label')).toBe('Убрать');
    await b.trigger('click');
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
  it('Chip без removable — без кнопки', () => {
    expect(wrap(Chip).find('button').exists()).toBe(false);
  });
  it('AvatarStack: больше max → +N и title; пусто → ничего', () => {
    const people = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name }));
    const w = wrap(AvatarStack, { people, max: 3 });
    expect(w.text()).toContain('+2');
    expect(w.find('[title="A, B, C, D, E"]').exists()).toBe(true);
    expect(wrap(AvatarStack, { people: [] }).html()).not.toContain('title');
  });
  it('Kbd: Mod→Ctrl, каждая клавиша — <kbd>', () => {
    const w = wrap(Kbd, { keys: 'Mod+K' });
    expect(w.findAll('kbd').map((k) => k.text())).toEqual(['Ctrl', 'K']);
    expect(wrap(Kbd, { keys: 'G I' }).findAll('kbd')).toHaveLength(2);
  });
  it('EmptyState: заголовок и слот actions', () => {
    const w = wrap(
      EmptyState,
      { title: 'Пусто', description: 'd' },
      { actions: () => h('button', 'Создать') },
    );
    expect(w.text()).toContain('Пусто');
    expect(w.text()).toContain('Создать');
  });
  it('Toolbar: role=toolbar и aria-label', () => {
    const w = wrap(Toolbar, { label: 'Панель' });
    expect(w.find('[role="toolbar"]').attributes('aria-label')).toBe('Панель');
  });
});

describe('Avatar', () => {
  it('без src сразу показывает инициалы', async () => {
    const { Avatar } = await import('./index');
    expect(wrap(Avatar, { name: 'Анна Белова' }).text()).toBe('АБ');
  });
});

describe('mobile: листы', () => {
  const setMobile = (m: boolean) => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: m,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    resetBreakpoint();
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    resetBreakpoint();
  });

  it('mobile: Menu открывается листом, пункт выбирается', async () => {
    setMobile(true);
    const onSelect = vi.fn();
    wrap(
      Menu,
      { items: [{ id: 'a', label: 'Пункт', onSelect }] },
      { trigger: () => h('button', 'M') },
    );
    document.body.querySelector('button')!.click();
    await vi.waitFor(() => expect($('[data-testid=sheet]')).not.toBeNull());
    expect($('[role=menu]')).toBeNull();
    const item = [...document.body.querySelectorAll('[data-testid=sheet] button')].find((b) =>
      b.textContent?.includes('Пункт'),
    ) as HTMLElement;
    item.click();
    expect(onSelect).toHaveBeenCalled();
    await vi.waitFor(() => expect($('[data-testid=sheet]')).toBeNull());
  });

  it('mobile: Select выбор опции меняет v-model', async () => {
    setMobile(true);
    const onUpdate = vi.fn();
    wrap(Select, {
      label: 'Статус',
      options: [
        { value: 'a', label: 'Альфа' },
        { value: 'b', label: 'Бета' },
      ],
      modelValue: 'a',
      'onUpdate:modelValue': onUpdate,
    });
    document.body.querySelector<HTMLElement>('button[aria-label="Статус"]')!.click();
    await vi.waitFor(() => expect($('[data-testid=sheet]')).not.toBeNull());
    [...document.body.querySelectorAll<HTMLElement>('[role=option]')]
      .find((b) => b.textContent?.includes('Бета'))!
      .click();
    expect(onUpdate).toHaveBeenCalledWith('b');
  });

  it('mobile: Tooltip не рендерит content', async () => {
    setMobile(true);
    const w = wrap(Tooltip, { content: 'Подсказка' }, { default: () => h('button', 'T') });
    await w.find('button').trigger('focus');
    await w.find('button').trigger('pointermove');
    await nextTick();
    expect(document.body.textContent).not.toContain('Подсказка');
    expect(w.find('button').exists()).toBe(true);
  });

  it('mobile: Popover открывается листом', async () => {
    setMobile(true);
    wrap(Popover, {}, { trigger: () => h('button', 'P'), default: () => h('p', 'Тело') });
    document.body.querySelector('button')!.click();
    await vi.waitFor(() => expect($('[data-testid=sheet]')?.textContent).toContain('Тело'));
  });
});
