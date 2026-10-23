import 'fake-indexeddb/auto';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { ids, reset } from '../../tasks/__tests__/data';
import type { Filter } from '..';
import FilterBuilder from '../saved/FilterBuilder.vue';

const state = ref<Filter>({ op: 'and', rules: [] });
const Host = defineComponent({
  setup: () => () =>
    h(FilterBuilder, {
      modelValue: state.value,
      spaceId: ids.space,
      'onUpdate:modelValue': (v: Filter) => (state.value = v),
    }),
});
const mountIt = () =>
  mount(Host, {
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
  });

beforeEach(async () => {
  state.value = { op: 'and', rules: [] };
  await reset();
});

describe('views:builder', () => {
  it('views:builder добавить правило и удалить его', async () => {
    const w = mountIt();
    await w.get('[data-role=add]').trigger('click');
    await w.get('[data-role=add]').trigger('click');
    expect(w.findAll('[data-testid=filter-rule]')).toHaveLength(2);
    expect(state.value.rules[0]).toEqual({ field: 'status', operator: 'in' });
    await w.findAll('[data-role=remove]')[0].trigger('click');
    expect(state.value.rules).toHaveLength(1);
  });
  it('views:builder смена поля и оператора сбрасывает значение', async () => {
    const w = mountIt();
    await w.get('[data-role=add]').trigger('click');
    await vi.waitFor(() => expect(w.find(`[data-value="${ids.todo}"]`).exists()).toBe(true));
    await w.get(`[data-value="${ids.todo}"]`).setValue(true);
    expect(state.value.rules[0].value).toEqual([ids.todo]);
    await w.get('[data-role=operator]').setValue('notIn');
    expect(state.value.rules[0]).toEqual({ field: 'status', operator: 'notIn' });
    await w.get('[data-role=field]').setValue('dueDate');
    // операторы поля — только допустимые, первый выбран
    expect(w.findAll('[data-role=operator] option').map((o) => o.element.value)).toEqual([
      'before',
      'after',
      'isEmpty',
      'isNotEmpty',
    ]);
    expect(state.value.rules[0]).toEqual({ field: 'dueDate', operator: 'before' });
  });
  it('views:builder переключатель И/ИЛИ и значение без редактора для isEmpty', async () => {
    const w = mountIt();
    await w.get('[data-op=or]').trigger('click');
    expect(state.value.op).toBe('or');
    await w.get('[data-role=add]').trigger('click');
    await w.get('[data-role=field]').setValue('assignee');
    await w.get('[data-role=operator]').setValue('isEmpty');
    expect(w.find('[data-value]').exists()).toBe(false);
    await w.get('[data-op=and]').trigger('click');
    expect(state.value.op).toBe('and');
  });
});
