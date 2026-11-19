import { flushPromises, mount } from '@vue/test-utils';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '@planar/web/modules';
import AiSettings from './AiSettings.vue';
import EnginesTab from './EnginesTab.vue';

// PLNRAPP-568: the workspace AI settings in tabs «Подключение», «Задачи ИИ», «Монитор движков»;
// «Автопилот» and «Harness ретро» — in the engines monitor for the chosen project
vi.mock('./api', () => ({
  AiApiError: class extends Error {},
  call: vi.fn(async () => ({ connection: null, effective: null })),
}));
// the router: only the current query and replace (vue-router is not a dependency of the modules)
const { route, replace, stub } = await vi.hoisted(async () => {
  const { defineComponent, h, ref } = await import('vue');
  const route = ref<{ query: Record<string, string> }>({ query: {} });
  return {
    route,
    replace: vi.fn(async ({ query }: { query: Record<string, string> }) => {
      route.value = { query };
    }),
    stub: (testid: string) =>
      defineComponent({
        props: { projectId: String },
        setup: (p) => () => h('div', { 'data-testid': testid, 'data-project': p.projectId ?? '' }),
      }),
  };
});
vi.mock('@planar/web/modules', async (orig) => ({
  ...(await orig<typeof import('@planar/web/modules')>()),
  useRouter: () => ({ currentRoute: route, replace }),
  enabledForProject: (_m: string, id?: string) => id !== 'p-off',
  useSpaces: () => ({
    value: [
      {
        id: 's1',
        name: 'Space',
        projects: [
          { id: 'p1', name: 'Alpha' },
          { id: 'p-off', name: 'No AI' },
        ],
      },
    ],
  }),
}));
vi.mock('./AiMonitor.vue', () => ({ default: stub('ai-monitor') }));
vi.mock('./EngineMonitor.vue', () => ({ default: stub('engine-monitor') }));
vi.mock('./AutopilotSection.vue', () => ({ default: stub('ai-autopilot-section') }));
vi.mock('./RetroSection.vue', () => ({ default: stub('ai-retro') }));
vi.mock('./LimitsSection.vue', () => ({ default: stub('ai-limits') }));
vi.mock('./EgressSection.vue', () => ({ default: stub('ai-egress') }));
vi.mock('./ConnectionFields.vue', () => ({ default: stub('ai-fields') }));

beforeAll(() => {
  i18n.global.locale.value = 'ru';
});
const at = (query: Record<string, string> = {}) =>
  (route.value = { query: { s: 'ai:workspace', ...query } });
const tabs = (w: ReturnType<typeof mount>) => w.findAll('[role="tab"]').map((t) => t.text());

describe('AiSettings: workspace tabs', () => {
  it('three tabs; ?tab= opens «Задачи ИИ» and «Монитор движков»', async () => {
    at({ tab: 'tasks' });
    const w = mount(AiSettings, { props: { level: 'workspace' } });
    await flushPromises();
    expect(tabs(w)).toEqual(['Подключение', 'Задачи ИИ', 'Монитор движков']);
    expect(w.find('[data-testid="ai-monitor"]').exists()).toBe(true);
    at({ tab: 'engines' });
    await flushPromises();
    expect(w.find('[data-testid="ai-monitor"]').exists()).toBe(false);
    expect(w.find('[data-testid="ai-engines-tab"]').exists()).toBe(true);
    // «Подключение» is the default: the address loses ?tab=
    at({ tab: 'nope' });
    await flushPromises();
    expect(replace).toHaveBeenLastCalledWith({ query: { s: 'ai:workspace' } });
    expect(w.find('[data-testid="ai-form"]').isVisible()).toBe(true);
  });

  it('the project page keeps its tabs and has no autopilot or retro', async () => {
    at();
    const w = mount(AiSettings, { props: { level: 'project', projectId: 'p1' } });
    await flushPromises();
    expect(tabs(w)).toEqual(['Подключение', 'Пакеты и правила']);
    expect(w.find('[data-testid="ai-limits"]').exists()).toBe(true);
    expect(w.find('[data-testid="ai-autopilot-section"]').exists()).toBe(false);
    expect(w.find('[data-testid="ai-retro"]').exists()).toBe(false);
  });
});

describe('EnginesTab: a project or «Все»', () => {
  it('«Все» — the monitor of all; a project — its autopilot, retro and monitor', async () => {
    const w = mount(EnginesTab);
    await flushPromises();
    const sel = w.find('select[data-testid="ai-engines-project"]');
    expect(sel.findAll('option').map((o) => o.text())).toEqual(['Все', 'Alpha']);
    expect(w.find('[data-testid="engine-monitor"]').attributes('data-project')).toBe('');
    expect(w.find('[data-testid="ai-autopilot-section"]').exists()).toBe(false);
    expect(w.find('[data-testid="ai-engines-pick"]').exists()).toBe(true);
    await sel.setValue('p1');
    expect(w.find('[data-testid="ai-autopilot-section"]').attributes('data-project')).toBe('p1');
    expect(w.find('[data-testid="ai-retro"]').attributes('data-project')).toBe('p1');
    expect(w.find('[data-testid="engine-monitor"]').attributes('data-project')).toBe('p1');
  });
});
