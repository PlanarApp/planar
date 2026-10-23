import 'fake-indexeddb/auto';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../../i18n/en';
import ru from '../../../i18n/ru';
import { ids } from '../../../tasks/__tests__/data';
import { registerModules, setEnabledModules } from '../../../modules/registry';
import type { Filter } from '../..';
import FilterBuilder from '../FilterBuilder.vue';

const state = ref<Filter>({ op: 'and', rules: [{ field: 'cycle', operator: 'in' }] });
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
    global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
  });
const fieldValues = (w: ReturnType<typeof mountIt>) =>
  w.findAll('[data-role=field] option').map((o) => (o.element as HTMLOptionElement).value);

describe('wk2: правило «Спринт» в конструкторе фильтра', () => {
  it('wk2: без модуля sprints поля cycle нет, с модулем — есть и пишет значение current', async () => {
    expect(fieldValues(mountIt())).not.toContain('cycle');

    registerModules([
      {
        id: 'sprints',
        views: [
          {
            id: 'sprint',
            label: 'x',
            icon: {} as never,
            component: async () => ({ default: {} as never }),
          },
        ],
      },
    ]);
    await setEnabledModules(['sprints']);
    const w = mountIt();
    expect(fieldValues(w)).toContain('cycle');
    const ops = w
      .findAll('[data-role=operator] option')
      .map((o) => (o.element as HTMLOptionElement).value);
    expect(ops).toEqual(['in', 'notIn', 'isEmpty', 'isNotEmpty']);
    await w.get('[data-value=current]').setValue(true);
    expect(state.value.rules[0]).toEqual({ field: 'cycle', operator: 'in', value: ['current'] });
    expect(w.text()).toContain('Текущий');
  });
});
