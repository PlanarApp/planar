import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../../i18n/en';
import ru from '../../../i18n/ru';
import { db } from '../../../sync';
import { id, ids, reset, T } from '../../../tasks/__tests__/data';
import FilterChips from '../FilterChips.vue';
import type { Filter } from '../..';

const mk = (type: string, name: string, options: object) => ({
  id: id(),
  type,
  options,
  name,
  projectId: ids.project,
  spaceId: ids.space,
  rank: 'a0',
  createdAt: T,
  updatedAt: T,
});
const show = async (filter: Filter) => {
  const w = mount(FilterChips, {
    props: { spaceId: ids.space, projectId: ids.project, modelValue: filter },
    global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
  });
  for (let i = 0; i < 20; i++) {
    await flushPromises();
    await new Promise((r) => setTimeout(r, 10));
  }
  return w;
};
beforeEach(reset);

describe('chip: чипы фильтра', () => {
  it('chip: исполнитель — имя, не id', async () => {
    const w = await show({
      op: 'and',
      rules: [{ field: 'assignee', operator: 'in', value: [ids.ann] }],
    });
    expect(w.text()).toContain('Ann');
    expect(w.text()).not.toContain(ids.ann);
  });

  it('chip: поле-выбор — подпись варианта, денежное — рубли, пользователь — имя', async () => {
    const sel = mk('select', 'Тип', { choices: [{ id: 'c1', label: 'Дефект' }] });
    const money = mk('money', 'Бюджет', {});
    const usr = mk('user', 'Ревьюер', {});
    await db.table('fieldDefs').bulkPut([sel, money, usr]);
    const w = await show({
      op: 'and',
      rules: [
        { field: `field:${sel.id}`, operator: 'eq', value: 'c1' },
        { field: `field:${money.id}`, operator: 'eq', value: 150000 },
        { field: `field:${usr.id}`, operator: 'eq', value: ids.ann },
      ] as never,
    });
    const t = w.text();
    expect(t).toContain('Дефект');
    expect(t).toContain('1500');
    expect(t).not.toContain('150000');
    expect(t).toContain('Ann');
    expect(t).not.toContain(ids.ann);
  });

  it('chip: удаление чипа убирает правило', async () => {
    const w = await show({
      op: 'and',
      rules: [{ field: 'assignee', operator: 'in', value: [ids.ann] }],
    });
    await w.get('[data-testid=filter-chip] button').trigger('click');
    expect(w.emitted('update:modelValue')![0][0]).toMatchObject({ rules: [] });
  });
});
