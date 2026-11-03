import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { AssigneePicker, DueDatePicker, LabelPicker, PriorityPicker, StatusPicker } from '../index';
import { ids, reset } from './data';

beforeEach(reset);
const i18n = createI18n({
  legacy: false,
  locale: 'ru',
  fallbackLocale: 'ru',
  messages: { ru, en },
});
const opts = { global: { plugins: [i18n] }, attachTo: document.body };
const key = async (k: string) => {
  const el = document.body.querySelector('[role="listbox"]')!.parentElement!;
  el.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  await flushPromises();
};
const open = async (w: ReturnType<typeof mount>) => {
  await w.find('button').trigger('click');
  await flushPromises();
};

describe('tasks:pickers', () => {
  it('StatusPicker: ↓ Enter выбирает статус', async () => {
    const w = mount(StatusPicker, { ...opts, props: { spaceId: ids.space, modelValue: ids.todo } });
    await flushPromises();
    await open(w);
    await key('ArrowDown');
    await key('Enter');
    expect(w.emitted('update:modelValue')?.[0]).toEqual([ids.done]);
    w.unmount();
  });
  it('PriorityPicker: ↓ Enter выбирает приоритет', async () => {
    const w = mount(PriorityPicker, { ...opts, props: { modelValue: 0 } });
    await open(w);
    await key('ArrowDown');
    await key('Enter');
    expect(w.emitted('update:modelValue')?.[0]).toEqual([1]);
    w.unmount();
  });
  it('PriorityPicker: compact без приоритета рендерит видимый значок', () => {
    const w = mount(PriorityPicker, { ...opts, props: { modelValue: 0, compact: true } });
    expect(w.find('button svg').exists()).toBe(true);
    w.unmount();
  });
  it('AssigneePicker: множественный выбор, деактивированные не показаны', async () => {
    const w = mount(AssigneePicker, { ...opts, props: { spaceId: ids.space, modelValue: [] } });
    await open(w);
    await vi.waitFor(() =>
      expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(1),
    );
    await key('Enter');
    expect(w.emitted('update:modelValue')?.[0]).toEqual([[ids.ann]]);
    w.unmount();
  });
  it('PriorityPicker: Popover монтируется лениво; фокус с клавиатуры сохраняется, клик открывает', async () => {
    const w = mount(PriorityPicker, { ...opts, props: { modelValue: 0 } });
    expect(document.body.querySelector('[aria-expanded]')).toBeNull(); // a light button without reka-ui
    const plain = w.find('button').element;
    expect(plain.getAttribute('aria-label')).toBeTruthy();
    plain.focus();
    plain.dispatchEvent(new FocusEvent('focus')); // keyboard focus (in happy-dom :focus-visible is not computed)
    await flushPromises();
    const trigger = w.find('button').element;
    expect(trigger.getAttribute('aria-expanded')).toBe('false'); // the Popover trigger
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-label')).toBe(plain.getAttribute('aria-label'));
    await w.find('button').trigger('click'); // Enter and Space on a button are click
    await flushPromises();
    const list = document.body.querySelector('[role="listbox"]')!;
    expect(list).not.toBeNull();
    expect(list.parentElement!.contains(document.activeElement)).toBe(true); // focus in the picker window
    w.unmount();
  });
  it('PriorityPicker: клик без наведения и фокуса открывает окно сразу', async () => {
    const w = mount(PriorityPicker, { ...opts, props: { modelValue: 0 } });
    await open(w);
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
    w.unmount();
  });
  it('LabelPicker PJ-5: «Создать» только для новой метки и только с projectId', async () => {
    const type = async (v: string) => {
      const input = document.body
        .querySelector('[role="listbox"]')!
        .parentElement!.querySelector('input')!;
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flushPromises();
    };
    const w = mount(LabelPicker, {
      ...opts,
      props: { spaceId: ids.space, projectId: ids.project, modelValue: [] },
    });
    await open(w);
    await type('new-one');
    expect(document.body.textContent).toContain('Создать «new-one»');
    await type('BUG'); // exists (case-insensitive)
    expect(document.body.textContent).not.toContain('Создать');
    w.unmount();
    const s = mount(LabelPicker, { ...opts, props: { spaceId: ids.space, modelValue: [] } });
    await open(s);
    await type('new-one');
    expect(document.body.textContent).not.toContain('Создать');
    s.unmount();
  });
  it('DueDatePicker: ленивый Popover, клик открывает поле даты', async () => {
    const w = mount(DueDatePicker, { ...opts, props: { modelValue: null } });
    expect(document.body.querySelector('[aria-expanded]')).toBeNull();
    await open(w);
    expect(document.body.querySelector('input[type="date"]')).not.toBeNull();
    w.unmount();
  });
});
