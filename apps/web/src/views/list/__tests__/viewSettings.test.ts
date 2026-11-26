import 'fake-indexeddb/auto';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { reactive, ref } from 'vue';
import type { Row } from '@planar/shared';
import en from '../../../i18n/en';
import ru from '../../../i18n/ru';
import { ids, reset, task, until } from '../../../tasks/__tests__/data';
import type { TaskView } from '../../../tasks';
import { resetBreakpoint } from '../../../ui';
import type { ViewOptions } from '../..';
import { useViewSettings, type ViewSettingsSource } from '../viewSettings';

vi.mock('../../../router', async () => {
  const vr = await import('vue-router');
  const stub = { template: '<div />' };
  return {
    router: vr.createRouter({
      history: vr.createMemoryHistory(),
      routes: [{ path: '/:p(.*)*', component: stub }],
    }),
  };
});
const { TaskListView } = await import('..');

Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1600 });

const opts = (o: Partial<ViewOptions> = {}): ViewOptions => ({
  groupBy: 'status',
  sortBy: 'rank',
  sortDir: 'asc',
  showSubtasks: false,
  fields: ['status', 'assignee', 'priority', 'dueDate', 'labels'],
  ...o,
});
const view = (n: number, over: Record<string, unknown> = {}): TaskView =>
  ({
    ...task(n, over),
    key: `PLN-${n}`,
    assigneeIds: [],
    labelIds: [],
    assignedComments: { total: 0, resolved: 0, openAssignees: [] },
  }) as unknown as TaskView;
const status = (id: string, name: string, rank: string) =>
  ({
    id,
    spaceId: ids.space,
    projectId: ids.project,
    name,
    category: 'todo',
    color: null,
    rank,
  }) as unknown as Row<'statuses'>;
const statuses = [status('s1', 'One', 'a1'), status('s2', 'Two', 'a2')];
const ctx = { projectIds: [ids.project], group: { statuses, members: [], labels: [] } };

describe('useViewSettings (PLNRAPP-863)', () => {
  it('группирует по статусу в порядке статусов, пустые группы скрывает опцией', () => {
    const tasks = [view(1, { statusId: 's2' }), view(2, { statusId: 's2' })];
    const s = ref<ViewSettingsSource>({ options: opts() });
    const { groups } = useViewSettings(s, tasks, ctx);
    expect(groups.value.map((g) => [g.key, g.tasks.length])).toEqual([
      ['s1', 0],
      ['s2', 2],
    ]);
    s.value = { options: opts({ hideEmptyGroups: true }) };
    expect(groups.value.map((g) => g.key)).toEqual(['s2']);
  });
  it('сортирует внутри группы, подзадачи — по опции, фильтр — по passes', () => {
    const a = view(1, { statusId: 's1', priority: 3, rank: 'a1' });
    const b = view(2, { statusId: 's1', priority: 1, rank: 'a2' });
    const sub = view(3, { statusId: 's1', parentId: a.id, rank: 'a3' });
    const s = reactive<ViewSettingsSource>({ options: opts({ groupBy: 'none' }) });
    const passes = ref<(x: TaskView) => boolean>(() => true);
    const { groups } = useViewSettings(() => s, [a, b, sub], { ...ctx, passes });
    expect(groups.value[0]!.tasks.map((x) => x.number)).toEqual([1, 2]);
    s.options.sortBy = 'priority';
    expect(groups.value[0]!.tasks.map((x) => x.number)).toEqual([2, 1]);
    s.options.showSubtasks = true;
    expect(groups.value[0]!.tasks.map((x) => x.number)).toEqual([2, 1, 3]);
    passes.value = (x) => x.id !== b.id;
    expect(groups.value[0]!.tasks.map((x) => x.number)).toEqual([1, 3]);
  });
  it('видимые свойства — в порядке колонок списка, плотность — из настроек', () => {
    const s = { options: opts({ fields: ['labels', 'status', 'assignee'], wrapTitles: true }) };
    const { fields, columns, density } = useViewSettings(s, [], ctx);
    expect(fields.value).toEqual(['labels', 'status', 'assignee']);
    expect(columns.value).toEqual(['assignee', 'labels']);
    expect(density.value).toEqual({
      wrapTitles: true,
      showKey: false,
      showLabelNames: false,
      showEmpty: false,
    });
  });
  it('сортировка по заголовку — через колбэк источника настроек; ручной порядок — только rank↑', () => {
    const update = vi.fn();
    const s = { options: opts(), update };
    const { sortBy, manual } = useViewSettings(s, [], ctx);
    expect(manual.value).toBe(true);
    sortBy('priority');
    expect(update).toHaveBeenCalledWith({ sortBy: 'priority', sortDir: 'asc' });
    expect(s.options.sortBy).toBe('rank');
    // без колбэка — правка объекта настроек на месте, как раньше в «Списке»
    const own = { options: opts() };
    const h = useViewSettings(own, [], ctx);
    h.sortBy('dueDate');
    expect(own.options).toMatchObject({ sortBy: 'dueDate', sortDir: 'asc' });
    expect(h.manual.value).toBe(false);
  });
});

describe('TaskListView вне «Списка» (PLNRAPP-863)', () => {
  beforeEach(async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {} }) as never;
    resetBreakpoint();
    await reset();
  });
  const show = (props: Record<string, unknown>) =>
    mount(TaskListView, {
      props: { projectId: ids.project, ...props } as never,
      attachTo: document.body,
      global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
    });

  it('показывает задачи переданного источника с переданными настройками', async () => {
    const update = vi.fn();
    const w = show({
      source: { tasks: [view(1, { title: 'первая' }), view(2, { title: 'вторая' })] },
      settings: { options: opts({ groupBy: 'none', sortBy: 'title' }), update },
    });
    await until(() => w.findAll('[role=row][data-task]').length === 2);
    expect(w.findAll('[role=row][data-task]').map((r) => r.attributes('data-task'))).toEqual([
      'PLN-2',
      'PLN-1',
    ]);
    w.unmount();
  });
  it('dnd=false — без ручки перетаскивания и при ручном порядке', async () => {
    const tasks = [view(1)];
    const on = show({ source: { tasks }, settings: { options: opts() } });
    await until(() => on.find('[role=row][data-task]').exists());
    expect(on.find('[data-testid=row-grip]').exists()).toBe(true);
    on.unmount();
    const off = show({ source: { tasks }, settings: { options: opts() }, dnd: false });
    await until(() => off.find('[role=row][data-task]').exists());
    expect(off.find('[data-testid=row-grip]').exists()).toBe(false);
    off.unmount();
  });
});
