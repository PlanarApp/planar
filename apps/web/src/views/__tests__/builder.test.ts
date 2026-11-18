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
import { db } from '../../sync';

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
    // field operators — only the allowed ones, the first is selected
    expect(
      w.findAll('[data-role=operator] option').map((o) => (o.element as HTMLOptionElement).value),
    ).toEqual(['before', 'after', 'isEmpty', 'isNotEmpty']);
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

describe('views:builder fields-fix', () => {
  it('fields-fix: с projectId только поля проекта', async () => {
    const mk = (id: string, projectId: string) => ({
      id,
      spaceId: ids.space,
      projectId,
      name: `N${id}`,
      type: 'text',
      options: {},
      rank: 'a0',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    await db
      .table('fieldDefs')
      .bulkPut([mk('f-mine', ids.project), mk('f-other', 'other-project')]);
    const w = mount(FilterBuilder, {
      props: {
        modelValue: { op: 'and', rules: [{ field: 'status', operator: 'in' }] },
        spaceId: ids.space,
        projectId: ids.project,
      },
      global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
    });
    await vi.waitFor(() => expect(w.find('option[value="field:f-mine"]').exists()).toBe(true));
    expect(w.find('option[value="field:f-other"]').exists()).toBe(false);
  });
});

describe('views:builder PLNRAPP-508', () => {
  const T = '2026-01-01T00:00:00Z';
  const put = async () => {
    await db.table('projects').bulkPut([
      { id: 'p-near', spaceId: ids.space, name: 'Near', key: 'NR', rank: 'a2', archivedAt: null },
      { id: 'p-arch', spaceId: ids.space, name: 'Arch', key: 'AR', rank: 'a3', archivedAt: T },
    ]);
    const st = (id: string, projectId: string, name: string) => ({
      id,
      spaceId: ids.space,
      projectId,
      name,
      category: 'todo',
      color: '#888',
      rank: 'a5',
      createdAt: T,
      updatedAt: T,
    });
    await db
      .table('statuses')
      .bulkPut([st('s-near', 'p-near', 'Переговоры'), st('s-arch', 'p-arch', 'Решено')]);
  };
  const mountWith = (projectId?: string) =>
    mount(FilterBuilder, {
      props: {
        modelValue: { op: 'and', rules: [{ field: 'status', operator: 'in' }] },
        spaceId: ids.space,
        projectId,
      },
      global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
    });

  it('PLNRAPP-508: в фильтре проекта только его статусы', async () => {
    await put();
    const w = mountWith(ids.project);
    await vi.waitFor(() => expect(w.find(`[data-value="${ids.todo}"]`).exists()).toBe(true));
    expect(w.find('[data-value="s-near"]').exists()).toBe(false);
    expect(w.find('[data-value="s-arch"]').exists()).toBe(false);
  });
  it('PLNRAPP-508: без проекта — статусы живых проектов спейса, без архивных', async () => {
    await put();
    const w = mountWith();
    await vi.waitFor(() => expect(w.find('[data-value="s-near"]').exists()).toBe(true));
    expect(w.find(`[data-value="${ids.todo}"]`).exists()).toBe(true);
    expect(w.find('[data-value="s-arch"]').exists()).toBe(false);
  });
});
