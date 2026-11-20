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
const high = { field: 'priority' as const, operator: 'in' as const, value: ['high'] };
const low = { field: 'priority' as const, operator: 'in' as const, value: ['low'] };

describe('PLNRAPP-664: старый фильтр панели «Статус ИИ» → условие общего фильтра', () => {
  it('сохранённый вид показывает те же задачи — для каждого значения селектора', () => {
    const filters: (Filter | null)[] = [
      null,
      { op: 'and', rules: [] },
      { op: 'and', rules: [high] },
      { op: 'or', rules: [high] },
      { op: 'and', rules: [high, { field: 'aiStatus', operator: 'notIn', value: ['done'] }] },
    ];
    for (const f of filters)
      for (const s of AI_STATES) {
        const m = migrateAiStatus({ aiStatus: s }, f);
        expect(m?.rules.at(-1)).toEqual({ field: 'aiStatus', operator: 'in', value: [s] });
        expect(shown(m)).toEqual(before(f, s));
      }
  });
  it('«любое условие» с несколькими условиями: правило добавляется, задач не меньше прежнего', () => {
    const f: Filter = { op: 'or', rules: [high, low] };
    const m = migrateAiStatus({ aiStatus: 'failed' }, f)!;
    expect(m.op).toBe('or');
    expect(shown(m)).toEqual(expect.arrayContaining(before(f, 'failed')));
  });
  it('без старого значения или с неизвестным — фильтр как есть; повторная миграция ничего не меняет', () => {
    const f: Filter = { op: 'and', rules: [high] };
    expect(migrateAiStatus({}, f)).toBe(f);
    expect(migrateAiStatus({ aiStatus: null }, null)).toBeNull();
    expect(migrateAiStatus({ aiStatus: 'bogus' }, f)).toBe(f);
    expect(migrateAiStatus(undefined, f)).toBe(f);
    const m = migrateAiStatus({ aiStatus: 'running' }, f);
    expect(migrateAiStatus({ aiStatus: 'running' }, m)).toBe(m);
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
});
