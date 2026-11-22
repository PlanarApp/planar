import 'fake-indexeddb/auto';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { defineComponent, h, nextTick } from 'vue';
import { TooltipProvider } from 'reka-ui';
import { domainMutators } from '@planar/shared';
import en from '../../../i18n/en';
import ru from '../../../i18n/ru';
import { linkTasks } from '../../../links';
import { db, registerMutators, startSync, stopSync } from '../../../sync';
import { AssigneePicker, BulkAssigneePicker, PriorityPicker, StatusPicker } from '../../../tasks';
import OptionPicker from '../../../tasks/fields/OptionPicker.vue';
import { ids, id, reset, task, until } from '../../../tasks/__tests__/data';
import { resetBreakpoint } from '../../../ui';
import { toasts } from '../../../ui/toast';
import { commitImeOnEnter } from '../../../ui/imeEnter';
import { registerModules } from '../../../modules/registry';
import { useAuth } from '../../../auth/useAuth';
import type { ViewOptions } from '../..';

const { router } = vi.hoisted(() => ({ router: { current: undefined as never } }));
vi.mock('../../../router', async () => {
  const vr = await import('vue-router');
  const stub = { template: '<div />' };
  const r = vr.createRouter({
    history: vr.createMemoryHistory(),
    routes: [{ path: '/p/:projectId/:view?', name: 'project', component: stub }],
  });
  router.current = r as never;
  return { router: r };
});
const View = (await import('../View.vue')).default;
const { useSelection } = await import('../..');
const r = router.current as import('vue-router').Router;

// happy-dom doesn't compute the layout: give the list the window height
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });

const opts = (o: Partial<ViewOptions> = {}): ViewOptions => ({
  groupBy: 'status',
  sortBy: 'rank',
  sortDir: 'asc',
  showSubtasks: false,
  fields: ['status', 'assignee', 'priority', 'dueDate', 'labels'],
  ...o,
});
const rank = (n: number) => `a${String(n).padStart(5, '0')}`;

let w: VueWrapper;
const show = async (o: Partial<ViewOptions> = {}, wait = 'tr, [role=row][data-task]') => {
  w = mount(View, {
    props: { projectId: ids.project, options: opts(o) },
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
  });
  await until(() => w.find(wait).exists());
};
const rows = () => w.findAll('[role=row][data-task]');
const row = (t: string) => w.get(`[data-task="${t}"]`);
const titles = () => rows().map((x) => x.text());
// until with an async condition
const poll = async (f: () => Promise<unknown>, ms = 3000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await f();
    if (v) return v as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (Date.now() - t0 > ms) throw new Error('poll: таймаут');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const get = (tid: string) => db.table('tasks').get(tid);

beforeAll(() => registerMutators(domainMutators));
beforeEach(async () => {
  w?.unmount();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {} }) as never;
  resetBreakpoint();
  useSelection().clear();
  await stopSync();
  await reset();
  await startSync({
    userId: ids.ann,
    fetch: (() => Promise.reject(new TypeError('offline'))) as never,
  });
  await db._queue.clear();
  await r.push(`/p/${ids.project}`);
});

describe('list:groups', () => {
  it('list:groups по статусу в порядке rank', async () => {
    await db
      .table('tasks')
      .bulkPut([
        task(1, { statusId: ids.done, rank: rank(1) }),
        task(2, { rank: rank(2) }),
        task(3, { rank: rank(1) }),
      ]);
    await show();
    const text = w.text();
    expect(text.indexOf('Todo')).toBeLessThan(text.indexOf('Done'));
    expect(titles().map((x) => x.match(/t\d/)?.[0])).toEqual(['t3', 't2', 't1']);
  });
  it('list:groups задача с двумя исполнителями — в двух группах', async () => {
    const t = task(1);
    await db.table('tasks').put(t);
    await db.table('taskAssignees').bulkPut(
      [ids.ann, ids.bob].map((userId) => ({
        id: id(),
        taskId: t.id,
        userId,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    );
    await show({ groupBy: 'assignee' });
    expect(rows()).toHaveLength(2);
  });
  it('list:groups hideEmptyGroups скрывает группу без задач (PLNRAPP-115)', async () => {
    await db.table('tasks').put(task(1));
    await show();
    expect(w.text()).toContain('Done');
    w.unmount();
    await show({ hideEmptyGroups: true });
    expect(w.text()).not.toContain('Done');
    expect(rows()).toHaveLength(1);
  });
  it('list:groups сворачивание скрывает задачи группы', async () => {
    await db.table('tasks').bulkPut([task(1), task(2)]);
    await show();
    expect(rows()).toHaveLength(2);
    await w.get('[aria-expanded]').trigger('click');
    expect(rows()).toHaveLength(0);
  });
  it('list:wrapTitles название переносится, перетаскивание остаётся (PLANARAPP-25, -62)', async () => {
    await db.table('tasks').put(task(1));
    await show({ wrapTitles: true });
    expect(rows()[0]!.get('[data-testid=row-title]').classes()).toContain('break-words');
    expect(rows()[0]!.find('[data-testid=row-grip]').exists()).toBe(true);
    w.unmount();
    await show();
    // PLNRAPP-705: обрезается только в широкой области списка
    expect(rows()[0]!.get('[data-testid=row-title]').classes()).toContain(
      '@min-[720px]/list:truncate',
    );
    expect(rows()[0]!.find('[data-testid=row-grip]').exists()).toBe(true);
  });
  it('PLNRAPP-705 узкая область списка: те же поля, название без обрезки, строка растёт', async () => {
    const p = task(1, { title: 'Родитель' });
    await db
      .table('tasks')
      .bulkPut([p, task(2, { title: 'Длинное название задачи в узком списке', parentId: p.id })]);
    const o = { groupBy: 'none' as const, showSubtasks: true, fields: [...opts().fields] };
    const shape = () => {
      const x = row('PLN-2');
      return {
        cols: x.findAll('[data-col]').map((c) => c.attributes('data-col')),
        ids: x.findAll('[data-testid]').map((c) => c.attributes('data-testid')),
      };
    };
    await show(o);
    const wide = shape();
    // широкая область: высота строки фиксирована, виртуализатор её не измеряет
    expect((row('PLN-2').element.parentElement as HTMLElement).style.height).toBe('32px');
    w.unmount();
    const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 500 });
    try {
      await show(o);
      // раскладка — container query по области списка
      expect(w.get('[role=grid]').classes()).toContain('@container/list');
      expect(shape()).toEqual(wide);
      const title = row('PLN-2').get('[data-testid=row-title]');
      expect(title.text()).toBe('Длинное название задачи в узком списке');
      expect(title.classes()).not.toContain('truncate');
      expect(title.classes()).toContain('break-words');
      expect(title.classes()).toContain('@max-[720px]/list:flex-1');
      // вторая строка: колонки переносятся под название
      expect(row('PLN-2').get('[data-testid=row-cols]').classes()).toContain(
        '@max-[720px]/list:order-4',
      );
      // строка в две строки выше rowH — виртуализатор её измеряет (minHeight вместо height)
      const box = row('PLN-2').element.parentElement as HTMLElement;
      expect(box.style.minHeight).toBe('32px');
      expect(box.style.height).toBe('');
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', cw);
    }
  });
  it('list:groups подзадачи скрыты, пока showSubtasks=false', async () => {
    const p = task(1);
    await db.table('tasks').bulkPut([p, task(2, { parentId: p.id })]);
    await show();
    expect(rows()).toHaveLength(1);
  });
});

describe('list:inline', () => {
  it('list:inline заголовок: двойной клик, Enter сохраняет, пустой — нет', async () => {
    const t = task(1);
    await db.table('tasks').put(t);
    await show();
    await w.get('[role=gridcell].flex-1').trigger('dblclick');
    const input = w.get('textarea[aria-label="Название задачи"]');
    await input.setValue('  ');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect((await get(t.id)).title).toBe('t1');
    expect(await db._queue.count()).toBe(0);
    await w.get('[role=gridcell].flex-1').trigger('dblclick');
    const i2 = w.get('textarea[aria-label="Название задачи"]');
    // multi-line editing (PLNRAPP-70): a pasted line break is saved as a space
    await i2.setValue('new\nname');
    await i2.trigger('keydown', { key: 'Enter' });
    await poll(async () => (await get(t.id)).title === 'new name');
    expect(await db._queue.count()).toBe(1);
  });
  it('list:dblclick настоящая последовательность click-click-dblclick не открывает панель', async () => {
    await db.table('tasks').put(task(1));
    await show();
    const cell = w.get('[role=gridcell].flex-1');
    await cell.trigger('click');
    await cell.trigger('click');
    await cell.trigger('dblclick');
    await new Promise((r) => setTimeout(r, 400));
    expect(r.currentRoute.value.query.task).toBeUndefined();
    expect(w.find('textarea[aria-label="Название задачи"]').exists()).toBe(true);
  });
  it('list:inline статус меняет реплику', async () => {
    const t = task(1);
    await db.table('tasks').put(t);
    await show();
    w.getComponent(StatusPicker).vm.$emit('update:modelValue', ids.done);
    await poll(async () => (await get(t.id)).statusId === ids.done);
    expect(await db._queue.count()).toBe(1);
  });
  it('list:inline приоритет и исполнитель', async () => {
    const t = task(1);
    await db.table('tasks').put(t);
    await show();
    await row('PLN-1').trigger('pointerenter'); // the pickers on the right are mounted on hover
    w.getComponent(PriorityPicker).vm.$emit('update:modelValue', 2);
    await poll(async () => (await get(t.id)).priority === 2);
    w.getComponent(AssigneePicker).vm.$emit('update:modelValue', [ids.ann]);
    await poll(async () => (await db.table('taskAssignees').count()) === 1);
  });
});

describe('list:create', () => {
  const create = async (title: string) => {
    await w.get('[data-create] button').trigger('click');
    const input = w.get('[data-create] input');
    await input.setValue(title);
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
  };
  it('list:create в группе статуса — statusId группы, поле остаётся', async () => {
    await db.table('tasks').put(task(1));
    await show();
    // the first create button is in the Todo group; Done (the second) is needed
    await w.findAll('[data-create] button')[1].trigger('click');
    const input = w.get('[data-create] input');
    await input.setValue('fresh');
    await input.trigger('keydown', { key: 'Enter' });
    const t = await poll(async () =>
      (await db.table('tasks').toArray()).find((x) => x.title === 'fresh'),
    );
    expect(t.statusId).toBe(ids.done);
    expect((input.element as HTMLInputElement).value).toBe('');
    expect(w.find('[data-create] input').exists()).toBe(true);
  });
  // phone keyboard: the last word is still composing on Enter (PLANARAPP-21, -26)
  it('list:create с мобильной клавиатуры — полное название, поле очищено', async () => {
    const stop = commitImeOnEnter(document);
    await db.table('tasks').put(task(1));
    await show();
    await w.findAll('[data-create] button')[0].trigger('click');
    const el = w.get('[data-create] input').element as HTMLInputElement;
    el.dispatchEvent(new CompositionEvent('compositionstart'));
    el.value = 'перенос по словам';
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await poll(async () =>
      (await db.table('tasks').toArray()).some((x) => x.title === 'перенос по словам'),
    );
    await flushPromises();
    expect(el.value).toBe('');
    stop();
  });
  it('list:create в группе исполнителя — исполнитель', async () => {
    const t0 = task(1);
    await db.table('tasks').put(t0);
    await db.table('taskAssignees').put({
      id: id(),
      taskId: t0.id,
      userId: ids.ann,
      createdAt: t0.createdAt,
      updatedAt: t0.updatedAt,
    });
    await show({ groupBy: 'assignee' });
    await until(() => w.text().includes('Ann')); // dictionaries load separately
    await create('by ann');
    const t = await poll(async () =>
      (await db.table('tasks').toArray()).find((x) => x.title === 'by ann'),
    );
    const a = await db.table('taskAssignees').where('taskId').equals(t.id).toArray();
    expect(a.map((x) => x.userId)).toEqual([ids.ann]);
  });
  it('list:create в «Моей работе» — исполнитель я (PLANARAPP-59)', async () => {
    await db.table('tasks').put(task(1));
    w = mount(View, {
      props: {
        projectId: ids.project,
        options: opts(),
        scope: {
          projectIds: [ids.project],
          spaceIds: [ids.space],
          createIn: { projectId: ids.project, spaceId: ids.space },
          createAssigneeId: ids.bob,
        },
      },
      attachTo: document.body,
      global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
    });
    await until(() => w.find('[role=row][data-task]').exists());
    await create('mine');
    const t = await poll(async () =>
      (await db.table('tasks').toArray()).find((x) => x.title === 'mine'),
    );
    const a = await db.table('taskAssignees').where('taskId').equals(t.id).toArray();
    expect(a.map((x) => x.userId)).toEqual([ids.bob]);
  });
});

describe('list:select', () => {
  it('list:select Cmd-клик переключает выделение', async () => {
    await db.table('tasks').bulkPut([task(1), task(2)]);
    await show();
    await row('PLN-1').trigger('click', { metaKey: true });
    expect([...useSelection().selected.value]).toHaveLength(1);
    expect(row('PLN-1').attributes('aria-selected')).toBe('true');
    await row('PLN-1').trigger('click', { ctrlKey: true });
    expect(useSelection().selected.value.size).toBe(0);
  });
  it('list:select Shift-клик выделяет диапазон', async () => {
    await db.table('tasks').bulkPut([1, 2, 3].map((n) => task(n, { rank: rank(n) })));
    await show();
    await row('PLN-1').trigger('click', { metaKey: true });
    await row('PLN-3').trigger('click', { shiftKey: true });
    expect(useSelection().selected.value.size).toBe(3);
  });
  it('list:select клик открывает задачу через ?task', async () => {
    await db.table('tasks').put(task(1));
    await show();
    await row('PLN-1').trigger('click');
    await poll(async () => r.currentRoute.value.query.task === 'PLN-1');
  });
  it('PLNRAPP-139 «…» в строке открывает меню действий задачи, не открывая задачу', async () => {
    await db.table('tasks').put(task(1));
    await show();
    await row('PLN-1').get('[data-testid=row-menu]').trigger('click');
    await until(() => !!document.querySelector('[role=menu]'));
    expect(r.currentRoute.value.query.task).toBeUndefined();
  });
});

describe('PLNRAPP-291 режим выделения в Списке', () => {
  const checks = () => w.findAll('[role=row][data-task] input[type=checkbox]');
  it('без вызова чекбоксов и панели нет; Cmd-клик включает режим, снятие последней — выключает', async () => {
    await db.table('tasks').bulkPut([1, 2].map((n) => task(n, { rank: rank(n) })));
    await show();
    expect(checks()).toHaveLength(0);
    expect(w.find('[data-testid=select-all]').exists()).toBe(false);
    expect(w.find('[data-testid=bulk-bar]').exists()).toBe(false);
    await row('PLN-1').trigger('click', { ctrlKey: true });
    expect(checks()).toHaveLength(2);
    expect(w.find('[data-testid=select-all]').exists()).toBe(true);
    expect(w.get('[data-testid=bulk-bar]').text()).toContain('Выбрано: 1');
    await row('PLN-1').trigger('click', { metaKey: true });
    expect(checks()).toHaveLength(0);
    expect(w.find('[data-testid=bulk-bar]').exists()).toBe(false);
  });
  it('Shift-клик без якоря выделяет задачу, второй — диапазон подряд идущих строк', async () => {
    await db.table('tasks').bulkPut([1, 2, 3, 4].map((n) => task(n, { rank: rank(n) })));
    await show();
    await row('PLN-2').trigger('click', { shiftKey: true });
    expect(useSelection().selected.value.size).toBe(1);
    await row('PLN-4').trigger('click', { shiftKey: true });
    expect(rows().map((x) => x.attributes('aria-selected'))).toEqual([
      'false',
      'true',
      'true',
      'true',
    ]);
    expect(r.currentRoute.value.query.task).toBeUndefined();
  });
  it('Esc со страницы и клик по пустому месту сбрасывают выделение', async () => {
    await db.table('tasks').bulkPut([task(1), task(2)]);
    await show();
    await row('PLN-1').trigger('click', { metaKey: true });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(useSelection().selected.value.size).toBe(0);
    await row('PLN-1').trigger('click', { metaKey: true });
    await row('PLN-1').get('input[type=checkbox]').trigger('click');
    await row('PLN-2').trigger('click', { metaKey: true });
    expect(useSelection().selected.value.size).toBe(1);
    await w.get('[role=grid]').trigger('click');
    expect(useSelection().selected.value.size).toBe(0);
  });
  it('пункт «Выбрать» в контекстном меню включает режим с этой задачей', async () => {
    await db.table('tasks').bulkPut([task(1), task(2)]);
    await show();
    await row('PLN-2').trigger('contextmenu');
    const item = await until(() =>
      [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
        (x) => x.textContent?.trim() === 'Выбрать',
      ),
    );
    item!.click();
    await until(() => useSelection().selected.value.size === 1);
    expect(row('PLN-2').attributes('aria-selected')).toBe('true');
    expect(r.currentRoute.value.query.task).toBeUndefined();
  });
});

describe('list:bulk', () => {
  it('list:bulk статус всем выделенным', async () => {
    const ts = [task(1), task(2)];
    await db.table('tasks').bulkPut(ts);
    await show();
    useSelection().set(ts.map((x) => x.id));
    await until(() => w.find('[role=toolbar]').exists());
    w.get('[role=toolbar]').findComponent(StatusPicker).vm.$emit('update:modelValue', ids.done);
    await until(
      async () => (await db.table('tasks').where('statusId').equals(ids.done).count()) === 2,
    );
  });
  it('list:bulk статус: в списке только статусы проектов выделенных, чужой — сообщение (PLNRAPP-637)', async () => {
    const other = id();
    await db.table('statuses').put({
      id: other,
      spaceId: ids.space,
      projectId: id(),
      name: 'К работе',
      category: 'todo',
      color: '#888',
      rank: 'a0',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const ts = [task(1), task(2)];
    await db.table('tasks').bulkPut(ts);
    await show();
    useSelection().set(ts.map((x) => x.id));
    await until(() => w.find('[data-testid=bulk-bar]').exists());
    const sp = w.get('[data-testid=bulk-bar]').getComponent(StatusPicker);
    const shown = () =>
      sp
        .getComponent(OptionPicker)
        .props('options')
        .map((o: { label: string }) => o.label);
    await until(() => shown().includes('Done'));
    expect(shown()).not.toContain('К работе');
    sp.vm.$emit('update:modelValue', other);
    await until(() => toasts.value.some((x) => x.text.includes('его нет: 2')));
    expect(await db.table('tasks').where('statusId').equals(ids.todo).count()).toBe(2);
  });
  it('list:bulk архив — участник, без «Удалить» (PLNRAPP-155)', async () => {
    useAuth().user.value = (await db.table('users').get(ids.ann)) as never;
    const ts = [task(1), task(2)];
    await db.table('tasks').bulkPut(ts);
    await show();
    useSelection().set([ts[0].id]);
    await until(() => w.find('[role=toolbar]').exists());
    expect(w.find('[role=toolbar] button.bg-danger').exists()).toBe(false);
    await w.get('[data-testid=bulk-archive]').trigger('click');
    await poll(async () => !!(await db.table('tasks').get(ts[0].id)).archivedAt);
    expect(useSelection().selected.value.size).toBe(0);
  });
  it('list:bulk удаление (админ) с подтверждением', async () => {
    useAuth().user.value = (await db.table('users').get(ids.ann)) as never;
    await db.table('spaceMembers').where('userId').equals(ids.ann).modify({ role: 'admin' });
    const ts = [task(1), task(2)];
    await db.table('tasks').bulkPut(ts);
    await show();
    useSelection().set([ts[0].id]);
    await until(() => w.find('[role=toolbar]').exists());
    await w.get('[role=toolbar] button.bg-danger').trigger('click');
    expect(await db.table('tasks').count()).toBe(2);
    const ok = await until(() =>
      document.querySelector<HTMLElement>('[data-testid=confirm-delete]'),
    );
    ok!.click();
    await poll(async () => (await db.table('tasks').count()) === 1);
    expect(useSelection().selected.value.size).toBe(0);
  });
});

describe('list:keys', () => {
  const key = (k: string) => w.get('[role=grid]').trigger('keydown', { key: k });
  it('list:keys j/k двигают фокус', async () => {
    await db.table('tasks').bulkPut([1, 2].map((n) => task(n, { rank: rank(n) })));
    await show();
    expect(w.get('[role=grid]').classes()).toContain('focus-visible:ring-2');
    await key('j');
    expect(row('PLN-1').classes()).toContain('ring-2');
    // the row is ringed, the whole list is not (PLNRAPP-95)
    expect(w.get('[role=grid]').classes()).not.toContain('focus-visible:ring-2');
    await key('j');
    expect(row('PLN-2').classes()).toContain('ring-2');
    await key('k');
    expect(row('PLN-1').classes()).toContain('ring-2');
  });
  it('PLNRAPP-96 фокус выпавшей задачи — на следующую, у последней — на предыдущую; в другой группе — за ней', async () => {
    const ts = [1, 2, 3].map((n) => task(n, { rank: rank(n) }));
    const [, t2, t3] = ts;
    await db.table('tasks').bulkPut(ts);
    await show();
    const ringed = () =>
      rows()
        .find((x) => x.classes().includes('ring-2'))
        ?.attributes('data-task');
    await key('j');
    await key('j');
    expect(ringed()).toBe('PLN-2');
    await db.table('tasks').delete(t2.id);
    await until(() => rows().length === 2);
    expect(ringed()).toBe('PLN-3');
    await db.table('tasks').put({ ...t3, statusId: ids.done });
    await until(() => w.text().includes('Done1'));
    expect(ringed()).toBe('PLN-3');
    await db.table('tasks').delete(t3.id);
    await until(() => rows().length === 1);
    expect(ringed()).toBe('PLN-1');
  });
  it('PLNRAPP-107 выпала задача из боковой панели — панель показывает новую, фокус — в список', async () => {
    const { taskOpenMode } = await import('../../open');
    const ts = [1, 2, 3].map((n) => task(n, { rank: rank(n) }));
    await db.table('tasks').bulkPut(ts);
    await show();
    taskOpenMode.value = 'side';
    await key('j');
    await key('j');
    await r.push({ query: { task: 'PLN-2' } });
    // focus in the panel (its status picker)
    const sheet = document.body.appendChild(document.createElement('button'));
    sheet.focus();
    await db.table('tasks').delete(ts[1].id);
    await poll(async () => r.currentRoute.value.query.task === 'PLN-3');
    await until(() => document.activeElement === w.get('[role=grid]').element);
    sheet.remove();
    await r.push({ query: {} });
    taskOpenMode.value = 'modal';
  });
  it('PLNRAPP-133 стрелки — с вкладки «Задачи» и с кнопки панели после выбора статуса', async () => {
    const { taskOpenMode } = await import('../../open');
    const ts = [1, 2, 3].map((n) => task(n, { rank: rank(n) }));
    await db.table('tasks').bulkPut(ts);
    await show();
    const ringed = () =>
      rows()
        .find((x) => x.classes().includes('ring-2'))
        ?.attributes('data-task');
    const press = (el: HTMLElement, k: string) =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    // focus stayed on the clicked tab link: an arrow moves in the list and focuses it; Enter is the link's
    const nav = document.body.appendChild(document.createElement('nav'));
    const tab = nav.appendChild(document.createElement('a'));
    tab.href = '#';
    tab.focus();
    press(tab, 'ArrowDown');
    await until(() => ringed() === 'PLN-1');
    expect(document.activeElement).toBe(w.get('[role=grid]').element);
    tab.focus();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    tab.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    nav.remove();
    // side panel: the status button keeps focus after the picker — arrows still move
    taskOpenMode.value = 'side';
    await r.push({ query: { task: 'PLN-1' } });
    const side = document.body.appendChild(document.createElement('div'));
    side.dataset.testid = 'task-side';
    const btn = side.appendChild(document.createElement('button'));
    btn.focus();
    press(btn, 'ArrowDown');
    await poll(async () => r.currentRoute.value.query.task === 'PLN-2');
    side.remove();
    await r.push({ query: {} });
    taskOpenMode.value = 'modal';
  });
  it('PLNRAPP-80 D добавляет задачу в «Мой день» (солнце в строке) и убирает', async () => {
    const { useAuth } = await import('../../../auth/useAuth');
    useAuth().user.value = { id: ids.ann } as never;
    // PLNRAPP-709: «My day» — my tasks (assignee) due today; D sets / clears dueDate
    const t1 = task(1);
    await db.table('tasks').put(t1);
    await db.table('taskAssignees').put({
      id: id(),
      taskId: t1.id,
      userId: ids.ann,
      createdAt: t1.createdAt,
      updatedAt: t1.updatedAt,
    });
    await show();
    expect(row('PLN-1').find('[data-testid=row-in-day]').exists()).toBe(false);
    await key('j');
    await key('d');
    await until(() => row('PLN-1').find('[data-testid=row-in-day]').exists());
    await key('d');
    await until(() => !row('PLN-1').find('[data-testid=row-in-day]').exists());
    expect((await db.table('tasks').get(t1.id))?.dueDate).toBeNull();
  });
  it('list:keys x выделяет, Esc снимает', async () => {
    await db.table('tasks').put(task(1));
    await show();
    await key('j');
    await key('x');
    expect(useSelection().selected.value.size).toBe(1);
    await key('Escape');
    expect(useSelection().selected.value.size).toBe(0);
  });
  it('list:keys Enter открывает задачу; в поле ввода клавиши не работают', async () => {
    await db.table('tasks').put(task(1));
    await show();
    await key('j');
    await key('Enter');
    await poll(async () => r.currentRoute.value.query.task === 'PLN-1');
    await w.get('[data-create] button').trigger('click');
    await w.get('[data-create] input').trigger('keydown', { key: 'x' });
    expect(useSelection().selected.value.size).toBe(0);
  });
});

describe('list:polish', () => {
  it('polish: list пустой проект — после первой задачи поле остаётся для следующей', async () => {
    await show({}, 'button');
    // while the tasks load, a grid with groups is drawn: its first button is the group chevron
    await until(() => !w.find('[role=grid]').exists());
    await w.get('button').trigger('click');
    const input = w.get('[data-create] input');
    await input.setValue('first');
    // dictionaries load separately: repeat Enter until the task is created
    await poll(async () => {
      await input.trigger('keydown', { key: 'Enter' });
      return (await db.table('tasks').count()) > 0;
    });
    await until(() => rows().length === 1);
    expect(document.activeElement).toBe(w.get('[role=grid] [data-create] input').element);
  });
  it('polish: list после клика по чекбоксу и кнопке строки j/k/x работают', async () => {
    await db.table('tasks').bulkPut([1, 2].map((n) => task(n, { rank: rank(n) })));
    await show();
    const grid = w.get('[role=grid]');
    // checkbox of a row — only in the selection mode (PLNRAPP-291)
    await row('PLN-2').trigger('click', { metaKey: true });
    const cb = row('PLN-1').get('input[type=checkbox]');
    await cb.setValue(true);
    expect(document.activeElement).toBe(grid.element);
    useSelection().clear();
    await row('PLN-1').get('button').trigger('keydown', { key: 'j' });
    await row('PLN-1').get('button').trigger('keydown', { key: 'x' });
    expect(useSelection().selected.value.size).toBe(1);
  });
  it('PLNRAPP-88: j/x работают на русской раскладке (по e.code)', async () => {
    await db.table('tasks').bulkPut([1, 2].map((n) => task(n, { rank: rank(n) })));
    await show();
    useSelection().clear();
    const grid = w.get('[role=grid]');
    await grid.trigger('keydown', { key: 'о', code: 'KeyJ' });
    await grid.trigger('keydown', { key: 'ч', code: 'KeyX' });
    expect(useSelection().selected.value.size).toBe(1);
  });
});

describe('list:virtual', () => {
  it('list:virtual 10 000 задач — в DOM меньше 200 строк', async () => {
    await db
      .table('tasks')
      .bulkPut(Array.from({ length: 10000 }, (_, i) => task(i + 1, { rank: rank(i) })));
    await show({}, '[data-task]');
    expect(rows().length).toBeGreaterThan(0);
    expect(w.findAll('[role=row]').length).toBeLessThan(200);
  });
}, 30000);

describe('list:links', () => {
  it('links-ui: Список показывает BlockedIcon только у заблокированной', async () => {
    const [a, b] = [task(1), task(2)];
    await db.table('tasks').bulkPut([a, b]);
    await linkTasks(a.id, b.id, 'blocks');
    await show();
    await until(
      () => w.find(`[data-task="PLN-2"] [aria-label="Заблокирована"]`).exists() || undefined,
    );
    expect(row('PLN-1').find('[aria-label="Заблокирована"]').exists()).toBe(false);
  });
  it('links-ui: без связей иконки нет', async () => {
    await db.table('tasks').put(task(1));
    await show();
    expect(w.find('[aria-label="Заблокирована"]').exists()).toBe(false);
  });
});

describe('list:row', () => {
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const day = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return ymd(d);
  };
  it('list:row срок: вчера — danger, сегодня — warning, через 3 дня — muted', async () => {
    await db
      .table('tasks')
      .bulkPut([
        task(1, { dueDate: day(-1) }),
        task(2, { dueDate: day(0) }),
        task(3, { dueDate: day(3) }),
      ]);
    await show();
    const tone = (k: string) => row(k).findAll('[data-col=dueDate] span').at(-1)!.classes();
    expect(tone('PLN-1')).toContain('text-danger');
    expect(tone('PLN-2')).toContain('text-warning');
    expect(tone('PLN-3')).toContain('text-fg-muted');
  });
  it('list:row без меток, срока и исполнителей лишнего нет; пикеры не ловят клики', async () => {
    await db.table('tasks').put(task(1));
    await show();
    const r = row('PLN-1');
    // columns are in place (they don't jump), but empty; the pickers are not mounted until hover
    for (const c of ['assignee', 'dueDate', 'priority', 'labels'])
      expect(r.find(`[data-col=${c}]`).text()).toBe('');
    expect(r.find('[data-col=assignee] [aria-label="Без исполнителя"]').exists()).toBe(true);
    expect(r.find('[data-col=dueDate] button').exists()).toBe(false);
  });
});

describe('list:newTaskMenu', () => {
  // the menu's IconButton requires TooltipProvider (App.vue provides it)
  const show = async () => {
    w = mount(
      defineComponent({
        render: () =>
          h(TooltipProvider, null, () => h(View, { projectId: ids.project, options: opts() })),
      }),
      {
        attachTo: document.body,
        global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
      },
    );
    await until(() => w.find('[role=row][data-task]').exists());
  };
  const trigger = () => w.find('button[aria-label="Новая задача из…"]');
  let when = true;
  const reg = () =>
    registerModules([
      {
        id: 'pf2menu',
        commands: [
          {
            id: 'yes',
            label: 'Из шаблона PF2',
            newTaskMenu: true,
            when: () => when,
            run: () => {},
          },
          { id: 'plain', label: 'Обычная PF2', run: () => {} },
        ],
      },
    ]);

  it('pf2: нет команд с newTaskMenu — меню не рендерится', async () => {
    await db.table('tasks').put(task(1));
    await show();
    expect(trigger().exists()).toBe(false);
  });
  it('pf2: команда с newTaskMenu и when=true — меню есть, пункт виден; без newTaskMenu — нет', async () => {
    reg();
    when = true;
    await db.table('tasks').put(task(1));
    await show();
    await trigger().trigger('keydown', { key: 'Enter' });
    await until(() => document.body.textContent!.includes('Из шаблона PF2'));
    expect(document.body.textContent).not.toContain('Обычная PF2');
  });
  it('pf2: when=false — меню не рендерится', async () => {
    reg();
    when = false;
    await db.table('tasks').put(task(1));
    await show();
    expect(trigger().exists()).toBe(false);
  });
});

describe('PJ-8', () => {
  it('PJ-8 включённые поля видны и при пустом значении (колонки в строке)', async () => {
    await db.table('tasks').put(task(1));
    await show({ fields: ['status', 'project', 'assignee', 'priority', 'dueDate', 'labels'] });
    for (const c of ['project', 'assignee', 'priority', 'dueDate', 'labels'])
      expect(row('PLN-1').find(`[data-col=${c}]`).exists()).toBe(true);
  });
  it('PJ-8 поле «Проект» показывает имя проекта', async () => {
    await db.table('tasks').put(task(1));
    await show({ fields: ['status', 'project'] });
    const name = (await db.table('projects').get(ids.project)).name;
    expect(row('PLN-1').get('[data-col=project]').text()).toBe(name);
  });
  it('PJ-8 мобильная карточка: пустые включённые поля остаются', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {} }) as never;
    resetBreakpoint();
    await db.table('tasks').put(task(1));
    await show({ fields: ['status', 'priority', 'dueDate', 'labels', 'assignee'] });
    // status icon + 4 empty-field icons
    expect(row('PLN-1').findAll('svg').length).toBeGreaterThanOrEqual(5);
  });
  it('PJ-8 мобильная карточка: «Проект» — имя проекта, а не иконка папки', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {} }) as never;
    resetBreakpoint();
    await db.table('tasks').put(task(1));
    await show({ fields: ['status', 'project'] });
    const name = (await db.table('projects').get(ids.project)).name;
    expect(row('PLN-1').get('[data-testid=card-project]').text()).toBe(name);
  });
  it('PJ-8 умолчание: у не-проекта «Проект» включён, у проекта нет; явный набор не меняется', async () => {
    const { optionsFrom } = await import('../../options');
    expect(optionsFrom(undefined).fields).not.toContain('project');
    expect(optionsFrom(undefined, true).fields).toContain('project');
    expect(optionsFrom({ fields: ['status'] }, true).fields).toEqual(['status']);
  });
});

describe('PLNRAPP-281 выбор задач на мобильной', () => {
  const mobile = () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {} }) as never;
    resetBreakpoint();
  };
  it('чекбокса нет до выбора; в режиме выбора он снимает выбор, панель показывает счётчик', async () => {
    mobile();
    await db.table('tasks').bulkPut([task(1), task(2)]);
    await show();
    expect(row('PLN-1').find('[data-testid=row-select]').exists()).toBe(false);
    // the first line: status · key · badges
    const line = row('PLN-1').get('[data-testid=card-key]').element.parentElement!;
    expect(line.contains(row('PLN-1').findComponent(StatusPicker).element)).toBe(true);
    expect(line.contains(row('PLN-1').get('[data-testid=card-badges]').element)).toBe(true);
    // the first one — the «Выбрать» item of the menu
    useSelection().toggle(row('PLN-1').attributes('data-task-id')!);
    await nextTick();
    const box = () => row('PLN-1').get('[data-testid=row-select] input');
    expect((box().element as HTMLInputElement).checked).toBe(true);
    expect(row('PLN-2').find('[data-testid=row-select]').exists()).toBe(true);
    expect([...useSelection().selected.value]).toHaveLength(1);
    expect(row('PLN-1').attributes('aria-selected')).toBe('true');
    expect(w.get('[data-testid=bulk-bar]').text()).toContain('1');
    await box().setValue(false);
    expect(useSelection().selected.value.size).toBe(0);
    expect(r.currentRoute.value.query.task).toBeUndefined();
  });
  it('пока есть выбор, тап по карточке переключает выбор, а не открывает задачу', async () => {
    mobile();
    await db.table('tasks').bulkPut([task(1), task(2)]);
    await show();
    useSelection().toggle(row('PLN-1').attributes('data-task-id')!);
    await nextTick();
    await row('PLN-2').trigger('click');
    expect(useSelection().selected.value.size).toBe(2);
    await row('PLN-1').trigger('click');
    expect(useSelection().selected.value.size).toBe(1);
    await new Promise((x) => setTimeout(x, 300));
    expect(r.currentRoute.value.query.task).toBeUndefined();
  });
  it('без «…» (меню — долгим нажатием); строка родителя — иконка, статус, ключ, имя', async () => {
    mobile();
    const p = task(1, { rank: rank(1) });
    const kid = task(2, { rank: rank(2), parentId: p.id, statusId: ids.done });
    await db.table('tasks').bulkPut([p, kid]);
    await show({ showSubtasks: true });
    expect(row('PLN-1').find('[data-testid=row-menu]').exists()).toBe(false);
    const line = row('PLN-2').get('[data-testid=card-parent]');
    await until(() => line.find('svg[data-category]').exists());
    expect(line.text()).toBe(`PLN-1${p.title}`);
    expect(line.find('.truncate').text()).toBe(p.title);
    // PLNRAPP-783: self-start даёт ширину по содержимому — без max-w-full длинное имя выходит за карточку
    expect(line.classes()).toContain('max-w-full');
  });
  it('без выбора тап по карточке открывает задачу', async () => {
    mobile();
    await db.table('tasks').put(task(1));
    await show();
    await row('PLN-1').trigger('click');
    await poll(async () => r.currentRoute.value.query.task === 'PLN-1');
    expect(useSelection().selected.value.size).toBe(0);
  });
});

describe('PLANARAPP-43 поля модулей на строке', () => {
  it('панель с card: true рендерится в каждой строке с taskId задачи', async () => {
    const Cell = defineComponent({
      props: { taskId: String },
      setup: (p) => () => h('i', { 'data-testid': 'card-ext' }, p.taskId),
    });
    registerModules([
      {
        id: 'pa43card',
        taskPanels: [
          { id: 'c', label: 'C', card: true, component: async () => ({ default: Cell }) },
        ],
      },
    ]);
    const t1 = task(1);
    await db.table('tasks').put(t1);
    await show();
    await until(() => w.find('[data-testid=card-ext]').exists());
    expect(w.get('[data-testid=card-ext]').text()).toBe(t1.id);
  });
});

describe('PLNRAPP-498 исполнители в массовой панели — три состояния', () => {
  const assign = async (n: number, users: string[]) => {
    const t = task(n, { rank: rank(n) });
    await db.table('tasks').put(t);
    await db.table('taskAssignees').bulkPut(
      users.map((userId) => ({
        id: id(),
        taskId: t.id,
        userId,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    );
    return t.id;
  };
  const users = async (tid: string) =>
    (await db.table('taskAssignees').where('taskId').equals(tid).toArray())
      .map((x) => x.userId)
      .sort();
  // PLN-1: Ann, Bob; PLN-2: Bob — Bob «у всех», Ann «у части»
  const setup = async () => {
    const a = await assign(1, [ids.ann, ids.bob]);
    const b = await assign(2, [ids.bob]);
    await show();
    useSelection().set([a, b]);
    await until(() => w.find('[data-testid=bulk-bar]').exists());
    return [a, b] as const;
  };
  const picker = () =>
    w.get('[data-testid=bulk-bar]').getComponent(BulkAssigneePicker).getComponent(OptionPicker);
  /** opens the picker, clicks the rows, closes it — the change is applied on close */
  const clicks = async (...picked: string[]) => {
    picker().vm.$emit('update:open', true);
    await flushPromises();
    for (const u of picked) {
      picker().vm.$emit('pick', u);
      await flushPromises();
    }
    picker().vm.$emit('update:open', false);
    await flushPromises();
  };
  const both = (a: string, b: string) =>
    Promise.all([users(a), users(b)]).then(([x, y]) => `${x.join()}|${y.join()}`);

  it('начальное состояние по выделенным: ☑ у всех, ▣ у части', async () => {
    await setup();
    expect(picker().props('selected')).toEqual([ids.bob]);
    expect(picker().props('partial')).toEqual([ids.ann]);
  });
  it('▣ → ☑ добавляет всем выделенным', async () => {
    const [a, b] = await setup();
    await clicks(ids.ann);
    const all = [ids.ann, ids.bob].sort().join();
    await poll(async () => (await both(a, b)) === `${all}|${all}`);
  });
  it('☑ → ☐ снимает у всех, нетронутый «у части» не меняется', async () => {
    const [a, b] = await setup();
    await clicks(ids.bob);
    await poll(async () => (await both(a, b)) === `${ids.ann}|`);
  });
  it('возврат в ▣ — «не менять»: задачи не меняются', async () => {
    const [a, b] = await setup();
    const before = await both(a, b);
    await clicks(ids.ann, ids.ann, ids.ann);
    await flushPromises();
    expect(await both(a, b)).toBe(before);
    expect(picker().props('partial')).toEqual([ids.ann]);
  });
  it('замена набора: снять Bob, отметить Ann', async () => {
    const [a, b] = await setup();
    await clicks(ids.bob, ids.ann);
    await poll(async () => (await both(a, b)) === `${ids.ann}|${ids.ann}`);
  });
  it('снять всех исполнителей', async () => {
    const [a, b] = await setup();
    await clicks(ids.bob, ids.ann, ids.ann);
    await poll(async () => (await both(a, b)) === '|');
  });
});

describe('вид «Карточки»', () => {
  it('на десктопе — карточки без строки заголовков, ключ и родитель в карточке', async () => {
    const p = task(1, { rank: rank(1) });
    // подзадача в другой группе: родителя над ней нет — строка родителя в карточке
    const kid = task(2, { rank: rank(2), parentId: p.id, statusId: ids.done });
    await db.table('tasks').bulkPut([p, kid]);
    w = mount(View, {
      props: { projectId: ids.project, options: opts({ showSubtasks: true }), cards: true },
      attachTo: document.body,
      global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
    });
    await until(() => w.find('[role=row][data-task]').exists());
    expect(w.find('[data-testid=col-sort]').exists()).toBe(false);
    expect(row('PLN-1').get('[data-testid=card-key]').text()).toBe('PLN-1');
    expect(row('PLN-2').get('[data-testid=card-parent]').text()).toContain('PLN-1');
    expect(w.find('[data-testid=row-grip]').exists()).toBe(false);
    w.unmount();
  });
});

describe('строка Списка — данные карточки (PLNRAPP-704)', () => {
  it('родитель в строке — ключ и название, как в карточке', async () => {
    const p = task(1, { rank: rank(1) });
    // подзадача в другой группе: родителя над ней нет — метка родителя в строке
    const kid = task(2, { rank: rank(2), parentId: p.id, statusId: ids.done });
    await db.table('tasks').bulkPut([p, kid]);
    await show({ showSubtasks: true });
    const label = row('PLN-2').get('[data-testid=row-parent]');
    expect(label.text()).toContain('PLN-1');
    expect(label.text()).toContain('t1');
    expect(label.attributes('title')).toBe('PLN-1 t1');
  });
  it('значок ИИ (работает) — в строке; при колонке «ИИ» — только в колонке', async () => {
    const t = task(1);
    await db.table('tasks').put(t);
    const at = new Date().toISOString();
    registerModules([
      {
        id: 'ai-row-704',
        activity: [
          {
            id: 'p',
            entity: 'projects',
            load: async () => [{ id: 'r1', itemId: t.id, state: 'running', startedAt: at }],
          },
        ],
      },
    ]);
    const mountRow = async (fields: ViewOptions['fields']) => {
      w = mount(
        defineComponent({
          render: () =>
            h(TooltipProvider, null, () =>
              h(View, { projectId: ids.project, options: opts({ fields }) }),
            ),
        }),
        {
          attachTo: document.body,
          global: {
            plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } }), r],
          },
        },
      );
      await until(() => w.find('[role=row][data-task]').exists());
    };
    await mountRow(['status', 'assignee']);
    await until(() => row('PLN-1').find('[data-testid=ai-status]').exists());
    expect(row('PLN-1').get('[data-testid=ai-status]').attributes('data-state')).toBe('running');
    w.unmount();
    await mountRow(['status', 'ai']);
    await until(() => row('PLN-1').get('[data-testid=cell-ai]').text() !== '—');
    expect(row('PLN-1').find('[data-testid=ai-status]').exists()).toBe(false);
  });
});
