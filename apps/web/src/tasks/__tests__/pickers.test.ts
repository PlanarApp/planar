import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { AssigneePicker, PriorityPicker, StatusPicker } from '../index';
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
});
