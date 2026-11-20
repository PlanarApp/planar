import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, effectScope, h, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../../i18n/en';
import ru from '../../../i18n/ru';
import { ids, reset } from '../../../tasks/__tests__/data';
import { registerModules, setEnabledModules } from '../../../modules/registry';
import type { WorkActivity } from '../../../modules/types';
import { matchFilter, type Filter, type FilterRule } from '../..';
import FilterBuilder from '../FilterBuilder.vue';
import { useTaskFilter } from '../useFilter';

// PLNRAPP-663: «Статус ИИ» в общем фильтре — мультивыбор значений селектора панели, только с модулем ai
const P = ids.project;
const at = new Date().toISOString();
const answer: WorkActivity[] = [
  { id: 'r1', itemId: 'id-A', state: 'running', startedAt: at },
  { id: 'r2', itemId: 'id-B', state: 'failed', startedAt: at },
  { id: 'r3', itemId: 'id-C', state: 'done', startedAt: at },
];
// a stub of the ai module: registered, so setEnabledModules does not load the real frontend
registerModules([
  {
    id: 'ai',
    activity: [{ id: 'p', entity: 'projects', load: async (p) => (p === P ? answer : []) }],
  },
]);

const rule = (operator: 'in' | 'notIn', value: string[]): FilterRule => ({
  field: 'aiStatus',
  operator,
  value,
});
const IDS = ['id-A', 'id-B', 'id-C', 'id-D'];

beforeEach(reset);
afterEach(() => setEnabledModules([]));

describe('PLNRAPP-663: правило aiStatus в matchFilter', () => {
  const ctx = {
    statuses: [],
    userId: 'u',
    today: '2026-11-20',
    aiStates: new Map([
      ['id-A', 'running'],
      ['id-B', 'failed'],
      ['id-C', 'done'],
    ]),
  };
  const pass = (r: FilterRule, c: Parameters<typeof matchFilter>[2] = ctx) =>
    IDS.filter((id) => matchFilter({ id } as never, { op: 'and', rules: [r] }, c));

  it('любой из / ни один из по нескольким значениям; без запусков — none', () => {
    expect(pass(rule('in', ['running', 'failed']))).toEqual(['id-A', 'id-B']);
    expect(pass(rule('in', ['none']))).toEqual(['id-D']);
    expect(pass(rule('notIn', ['running', 'none']))).toEqual(['id-B', 'id-C']);
  });
  it('без состояний (модуль выключен) правило пропускается без ошибки', () => {
    expect(pass(rule('in', ['running']), { ...ctx, aiStates: undefined })).toEqual(IDS);
  });
});

describe('PLNRAPP-663: useTaskFilter с aiStatus', () => {
  const run = () => {
    const scope = effectScope();
    const pred = scope.run(() =>
      useTaskFilter({ op: 'and', rules: [rule('in', ['running', 'none'])] }, [], null, () => P),
    )!;
    const pick = () => IDS.filter((id) => pred.value({ id } as never));
    return { pick, stop: () => scope.stop() };
  };

  it('модуль включён — фильтрует по состояниям задач проекта', async () => {
    await setEnabledModules(['ai']);
    const f = run();
    await vi.waitFor(() => expect(f.pick()).toEqual(['id-A', 'id-D']));
    f.stop();
  });
  it('модуль выключен — сохранённое условие игнорируется', async () => {
    await setEnabledModules([]);
    const f = run();
    await flushPromises();
    expect(f.pick()).toEqual(IDS);
    f.stop();
  });
});

describe('PLNRAPP-663: поле «Статус ИИ» в конструкторе фильтра', () => {
  const state = ref<Filter>({ op: 'and', rules: [] });
  const mountIt = (withAi = true) =>
    mount(
      defineComponent({
        setup: () => () =>
          h(FilterBuilder, {
            modelValue: state.value,
            spaceId: ids.space,
            projectId: P,
            withAi,
            'onUpdate:modelValue': (v: Filter) => (state.value = v),
          }),
      }),
      {
        global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
      },
    );
  const fieldValues = (w: ReturnType<typeof mountIt>, i = 0) =>
    w
      .findAll('[data-testid=filter-rule]')
      [i]!.findAll('[data-role=field] option')
      .map((o) => (o.element as HTMLOptionElement).value);

  it('модуль включён: поле есть, операторы мультивыбора, значения селектора панели, выбор нескольких', async () => {
    await setEnabledModules(['ai']);
    state.value = { op: 'and', rules: [{ field: 'status', operator: 'in' }] };
    const w = mountIt();
    expect(fieldValues(w)).toContain('aiStatus');
    await w.get('[data-role=field]').setValue('aiStatus');
    const ops = w
      .findAll('[data-role=operator] option')
      .map((o) => (o.element as HTMLOptionElement).value);
    expect(ops).toEqual(['in', 'notIn']);
    const values = w.findAll('input[type=checkbox]').map((x) => x.attributes('data-value'));
    expect(values).toEqual([
      'none',
      'queued',
      'running',
      'waiting_human',
      'waiting_subtasks',
      'failed',
      'done',
    ]);
    expect(w.text()).toContain('Нет запусков');
    expect(w.text()).toContain('Работает');
    await w.get('[data-value=running]').setValue(true);
    await w.get('[data-value=failed]').setValue(true);
    expect(state.value.rules[0]).toEqual(rule('in', ['running', 'failed']));
    w.unmount();
  });
  it('модуль выключен: поля нет, сохранённое условие показывается без ошибки', async () => {
    await setEnabledModules([]);
    state.value = {
      op: 'and',
      rules: [rule('in', ['running']), { field: 'status', operator: 'in' }],
    };
    const w = mountIt();
    expect(fieldValues(w, 1)).not.toContain('aiStatus');
    expect((w.get('[data-role=field]').element as HTMLSelectElement).value).toBe('aiStatus');
    w.unmount();
  });
  it('без withAi (дашборды, автоматизации) поля нет и при включённом модуле', async () => {
    await setEnabledModules(['ai']);
    state.value = { op: 'and', rules: [{ field: 'status', operator: 'in' }] };
    const w = mountIt(false);
    expect(fieldValues(w)).not.toContain('aiStatus');
    w.unmount();
  });
});
