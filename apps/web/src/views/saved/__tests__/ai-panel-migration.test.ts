import 'fake-indexeddb/auto';
import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { TooltipProvider } from 'reka-ui';
import { afterEach, describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../../i18n/en';
import ru from '../../../i18n/ru';
import { ids } from '../../../tasks/__tests__/data';
import { registerModules, setEnabledModules } from '../../../modules/registry';
import { matchFilter, type Filter } from '../..';
import { AI_STATES, migrateAiStatus } from '../../aiFilter';
import { optionsFrom } from '../../options';
import FilterBuilder from '../FilterBuilder.vue';
import OptionsBar from '../OptionsBar.vue';

// PLNRAPP-664: the panel «AI status» selector is gone; its old value of a view becomes a rule of the general filter
registerModules([{ id: 'ai' }]);
afterEach(() => setEnabledModules([]));

const ctx = {
  statuses: [],
  userId: 'u',
  today: '2026-11-20',
  aiStates: new Map([
    ['id-A', 'running'],
    ['id-B', 'failed'],
    ['id-C', 'done'],
    ['id-E', 'failed'],
  ]),
};
const tasks = [
  { id: 'id-A', priority: 'high' },
  { id: 'id-B', priority: 'high' },
  { id: 'id-C', priority: 'low' },
  { id: 'id-D', priority: 'low' },
  { id: 'id-E', priority: 'low' },
];
const shown = (f: Filter | null) =>
  tasks.filter((t) => !f || matchFilter(t as never, f, ctx)).map((t) => t.id);
// the old panel filter: on top of the view filter, `none` — no runs
const before = (f: Filter | null, s: string) =>
  shown(f).filter((id) => (ctx.aiStates.get(id) ?? 'none') === s);
// after: only the migrated filter
const after = (f: Filter | null, s: string) => shown(migrateAiStatus({ aiStatus: s }, f, 'list'));
const high = { field: 'priority' as const, operator: 'in' as const, value: ['high'] };
const low = { field: 'priority' as const, operator: 'in' as const, value: ['low'] };
const notDone = { field: 'aiStatus' as const, operator: 'notIn' as const, value: ['done'] };
const failed = { field: 'aiStatus' as const, operator: 'in' as const, value: ['failed'] };
const i18n = () => createI18n({ legacy: false, locale: 'ru', messages: { ru, en } });

describe('PLNRAPP-664: старый фильтр панели «Статус ИИ» → условие общего фильтра', () => {
  it('сохранённый вид показывает те же задачи — для каждого значения селектора и вида фильтра', () => {
    const filters: (Filter | null)[] = [
      null,
      { op: 'and', rules: [] },
      { op: 'or', rules: [] },
      { op: 'and', rules: [high] },
      { op: 'or', rules: [high] },
      { op: 'and', rules: [high, notDone] },
      { op: 'or', rules: [high, low] },
      { op: 'or', rules: [high, notDone] },
      { op: 'or', rules: [low, notDone, high] },
      { op: 'or', rules: [high, failed] },
      { op: 'and', rules: [failed] },
      { op: 'or', rules: [failed] },
    ];
    for (const f of filters)
      for (const s of AI_STATES) expect(after(f, s), JSON.stringify([f, s])).toEqual(before(f, s));
  });
  it('условие «Статус ИИ» — в общем фильтре, «все условия»; старое значение больше не нужно', () => {
    for (const f of [
      null,
      { op: 'or', rules: [high] } as Filter,
      { op: 'and', rules: [high] } as Filter,
    ]) {
      const m = migrateAiStatus({ aiStatus: 'failed' }, f, 'list')!;
      expect(m.op).toBe('and');
      expect(m.rules.at(-1)).toEqual(failed);
      expect(m.groups).toBeUndefined();
    }
  });
  it('«любое условие» с несколькими условиями: «Статус ИИ И (группа из старого фильтра)»', () => {
    const f: Filter = { op: 'or', rules: [high, low] };
    const m = migrateAiStatus({ aiStatus: 'failed' }, f, 'list')!;
    expect(m).toEqual({ op: 'and', rules: [failed], groups: [f] });
    expect(shown(m)).toEqual(['id-B', 'id-E']);
    expect(shown(m)).toEqual(before(f, 'failed'));
    // again — not changed (the filter is «all rules» with the rule)
    expect(migrateAiStatus({ aiStatus: 'failed' }, m, 'list')).toBe(m);
  });
  it('группа без заполненных условий — не условие; группы в «любое условие»', () => {
    const empty: Filter = { op: 'or', rules: [{ field: 'priority', operator: 'in' }] };
    expect(shown({ op: 'and', rules: [failed], groups: [empty] })).toEqual(['id-B', 'id-E']);
    expect(shown({ op: 'and', rules: [], groups: [empty] })).toEqual(shown(null));
    const anyOf: Filter = { op: 'or', rules: [failed], groups: [{ op: 'and', rules: [high] }] };
    expect(shown(anyOf)).toEqual(['id-A', 'id-B', 'id-E']);
  });
  it('без старого значения или с неизвестным — фильтр как есть; повторная миграция ничего не меняет', () => {
    const f: Filter = { op: 'and', rules: [high] };
    expect(migrateAiStatus({}, f, 'list')).toBe(f);
    expect(migrateAiStatus({ aiStatus: null }, null, 'list')).toBeNull();
    expect(migrateAiStatus({ aiStatus: 'bogus' }, f, 'list')).toBe(f);
    expect(migrateAiStatus(undefined, f, 'list')).toBe(f);
    const m = migrateAiStatus({ aiStatus: 'running' }, f, 'list');
    expect(migrateAiStatus({ aiStatus: 'running' }, m, 'list')).toBe(m);
  });
  it('только list, cards и board: в table, timeline и calendar старый фильтр задачи не сужал — фильтр как есть', () => {
    const f: Filter = { op: 'and', rules: [high] };
    for (const layout of ['list', 'cards', 'board'])
      expect(migrateAiStatus({ aiStatus: 'failed' }, f, layout), layout).toEqual({
        op: 'and',
        rules: [high, failed],
      });
    for (const layout of ['table', 'timeline', 'calendar', '', undefined, null]) {
      expect(migrateAiStatus({ aiStatus: 'failed' }, f, layout), String(layout)).toBe(f);
      expect(migrateAiStatus({ aiStatus: 'failed' }, null, layout), String(layout)).toBeNull();
      // the same tasks as before: all tasks of the view filter
      expect(shown(migrateAiStatus({ aiStatus: 'failed' }, f, layout))).toEqual(shown(f));
    }
  });
  it('старый ключ не попадает в настройки вида — при сохранении он уходит из config', () => {
    expect('aiStatus' in optionsFrom({ aiStatus: 'failed', groupBy: 'priority' })).toBe(false);
  });
  it('на панели нет селектора «Статус ИИ» (модуль ai включён)', async () => {
    await setEnabledModules(['ai']);
    const props = { spaceId: ids.space, projectId: ids.project, options: optionsFrom(undefined) };
    const w = mount(() => h(TooltipProvider, null, () => h(OptionsBar, props)), {
      global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
    });
    expect(w.find('[data-testid=ai-filter]').exists()).toBe(false);
    expect(w.text()).not.toContain('Статус ИИ');
    w.unmount();
  });
  it('группа видна в конструкторе фильтра, правится и удаляется', async () => {
    await setEnabledModules(['ai']);
    let model: Filter = { op: 'and', rules: [failed], groups: [{ op: 'or', rules: [high, low] }] };
    const w = mount(
      () =>
        h(FilterBuilder, {
          spaceId: ids.space,
          projectId: ids.project,
          withAi: true,
          modelValue: model,
          'onUpdate:modelValue': (v: Filter) => (model = v),
        }),
      { global: { plugins: [i18n()] } },
    );
    const group = w.get('[data-testid=filter-group]');
    expect(group.text()).toContain('Группа условий');
    expect(group.findAll('[data-testid=filter-rule]')).toHaveLength(2);
    await group.get('[data-op=and]').trigger('click');
    expect(model.groups).toEqual([{ op: 'and', rules: [high, low] }]);
    expect(model.rules).toEqual([failed]);
    await w.get('[data-role=remove-group]').trigger('click');
    expect(model).toEqual({ op: 'and', rules: [failed] });
    w.unmount();
  });
});
