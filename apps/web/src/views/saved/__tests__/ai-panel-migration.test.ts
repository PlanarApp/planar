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
import { AI_STATES, legacyAiStatus, migrateAiStatus } from '../../aiFilter';
import { optionsFrom, type ViewOptions } from '../../options';
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
// after: the migrated filter and the old value it could not take (applied as before, on top)
const after = (f: Filter | null, s: string) => {
  const config = { aiStatus: s };
  const legacy = legacyAiStatus(config, f);
  return shown(migrateAiStatus(config, f)).filter(
    (id) => !legacy || (ctx.aiStates.get(id) ?? 'none') === legacy,
  );
};
const high = { field: 'priority' as const, operator: 'in' as const, value: ['high'] };
const low = { field: 'priority' as const, operator: 'in' as const, value: ['low'] };
const notDone = { field: 'aiStatus' as const, operator: 'notIn' as const, value: ['done'] };

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
    ];
    for (const f of filters)
      for (const s of AI_STATES) expect(after(f, s), JSON.stringify([f, s])).toEqual(before(f, s));
  });
  it('фильтр принимает условие — оно последнее в «все условия», старого значения не остаётся', () => {
    for (const f of [
      null,
      { op: 'or', rules: [high] } as Filter,
      { op: 'and', rules: [high] } as Filter,
    ]) {
      const m = migrateAiStatus({ aiStatus: 'failed' }, f)!;
      expect(m.op).toBe('and');
      expect(m.rules.at(-1)).toEqual({ field: 'aiStatus', operator: 'in', value: ['failed'] });
      expect(legacyAiStatus({ aiStatus: 'failed' }, f)).toBeNull();
    }
  });
  it('«любое условие» с несколькими условиями: фильтр не меняется, старое значение фильтрует как раньше', () => {
    const f: Filter = { op: 'or', rules: [high, low] };
    expect(migrateAiStatus({ aiStatus: 'failed' }, f)).toBe(f);
    expect(legacyAiStatus({ aiStatus: 'failed' }, f)).toBe('failed');
    expect(after(f, 'failed')).toEqual(['id-B', 'id-E']);
    // the filter later turned into «all rules» — the next load moves the value into it
    expect(legacyAiStatus({ aiStatus: 'failed' }, { ...f, op: 'and' })).toBeNull();
    expect(legacyAiStatus({ aiStatus: null }, f)).toBeNull();
    expect(legacyAiStatus({ aiStatus: 'bogus' }, f)).toBeNull();
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
  it('оставшееся старое значение видно в фильтре вида и снимается', async () => {
    await setEnabledModules(['ai']);
    let options: ViewOptions = { ...optionsFrom(undefined), aiStatus: 'failed' };
    const w = mount(
      () =>
        h(TooltipProvider, null, () =>
          h(OptionsBar, {
            spaceId: ids.space,
            projectId: ids.project,
            options,
            'onUpdate:options': (v: ViewOptions) => (options = v),
          }),
        ),
      {
        attachTo: document.body,
        global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
      },
    );
    expect(w.find('[data-testid=ai-filter]').exists()).toBe(false);
    expect(w.find('[data-testid=filter-active]').exists()).toBe(true);
    await w.find('[data-testid=filter-toggle]').trigger('click');
    await new Promise((r) => setTimeout(r, 0));
    const note = document.querySelector('[data-testid=ai-legacy]');
    expect(note?.textContent).toContain('Статус ИИ — Ошибка');
    (document.querySelector('[data-testid=ai-legacy-clear]') as HTMLElement).click();
    expect(options.aiStatus).toBeNull();
    w.unmount();
  });
});
