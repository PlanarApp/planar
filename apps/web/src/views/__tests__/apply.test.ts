import 'fake-indexeddb/auto';
import { mount } from '@vue/test-utils';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { domainMutators } from '@planar/shared';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { registerMutators } from '../../sync';
import { ids, reset, task, until } from '../../tasks/__tests__/data';
import { db } from '../../sync';
import { resetBreakpoint } from '../../ui';
import type { Filter, ViewOptions } from '..';

vi.mock('../../router', async () => {
  const vr = await import('vue-router');
  const stub = { template: '<div />' };
  return {
    router: vr.createRouter({
      history: vr.createMemoryHistory(),
      routes: [{ path: '/:p(.*)*', component: stub }],
    }),
  };
});
const ListView = (await import('../list/View.vue')).default;
const BoardView = (await import('../board/View.vue')).default;

const opts = (fields: ViewOptions['fields']): ViewOptions => ({
  groupBy: 'status',
  sortBy: 'rank',
  sortDir: 'asc',
  showSubtasks: false,
  fields,
});
const ALL: ViewOptions['fields'] = ['status', 'assignee', 'priority', 'dueDate', 'labels'];
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });

const mounted: { unmount(): void }[] = [];
const show = (c: object, o: ViewOptions, filter?: Filter) => {
  const w = mount(c, {
    props: { projectId: ids.project, options: o, filter },
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
  });
  mounted.push(w);
  return w;
};

beforeAll(() => registerMutators(domainMutators));
beforeEach(async () => {
  mounted.splice(0).forEach((w) => w.unmount());
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {} }) as never;
  resetBreakpoint();
  await reset();
  await db
    .table('tasks')
    .bulkPut([
      task(1, { title: 'первая', priority: 1 }),
      task(2, { title: 'вторая', priority: 3 }),
    ]);
});

describe('views:apply', () => {
  const filter: Filter = {
    op: 'and',
    rules: [{ field: 'priority', operator: 'in', value: [1] }],
  };
  it('views:apply список и доска скрывают задачи вне фильтра', async () => {
    const list = show(ListView, opts(ALL), filter);
    await until(() => list.findAll('[data-task]').length > 0);
    expect(list.findAll('[data-task]').map((x) => x.text())).toEqual([
      expect.stringContaining('первая'),
    ]);
    const board = show(BoardView, opts(ALL), filter);
    await until(() => board.findAll('article').length > 0);
    expect(board.findAll('article')).toHaveLength(1);
    expect(board.text()).not.toContain('вторая');
  });
  it('views:apply fields убирает колонку списка и поле карточки', async () => {
    const list = show(ListView, opts(ALL));
    await until(() => list.findAll('[data-task]').length === 2);
    await list.get('[data-task]').trigger('pointerenter'); // пикеры справа монтируются по наведению
    const cells = list.get('[data-task]').findAll('[role=gridcell]').length;
    list.unmount();
    const less = show(ListView, opts(['status']));
    await until(() => less.findAll('[data-task]').length === 2);
    await less.get('[data-task]').trigger('pointerenter');
    expect(less.get('[data-task]').findAll('[role=gridcell]').length).toBe(cells - 8);
    await db.table('tasks').put(task(3, { title: 'срок', dueDate: '2026-12-24' }));
    const withDue = show(BoardView, opts(ALL));
    await until(() => withDue.text().includes('срок'));
    expect(withDue.text()).toContain('24 дек');
    const noDue = show(BoardView, opts(['status']));
    await until(() => noDue.text().includes('срок'));
    expect(noDue.text()).not.toContain('24 дек');
  });
});
