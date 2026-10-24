import 'fake-indexeddb/auto';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { domainMutators } from '@planar/shared';
import en from '../../../i18n/en';
import ru from '../../../i18n/ru';
import { linkTasks } from '../../../links';
import { db, registerMutators, startSync, stopSync } from '../../../sync';
import { AssigneePicker, PriorityPicker, StatusPicker } from '../../../tasks';
import { ids, id, reset, task, until } from '../../../tasks/__tests__/data';
import { resetBreakpoint } from '../../../ui';
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

// happy-dom не считает раскладку: даём списку высоту окна
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
// until с async-условием
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
  it('list:groups сворачивание скрывает задачи группы', async () => {
    await db.table('tasks').bulkPut([task(1), task(2)]);
    await show();
    expect(rows()).toHaveLength(2);
    await w.get('[aria-expanded]').trigger('click');
    expect(rows()).toHaveLength(0);
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
    const input = w.get('input[aria-label="Название задачи"]');
    await input.setValue('  ');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect((await get(t.id)).title).toBe('t1');
    expect(await db._queue.count()).toBe(0);
    await w.get('[role=gridcell].flex-1').trigger('dblclick');
    const i2 = w.get('input[aria-label="Название задачи"]');
    await i2.setValue('new');
    await i2.trigger('keydown', { key: 'Enter' });
    await poll(async () => (await get(t.id)).title === 'new');
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
    expect(w.find('input[aria-label="Название задачи"]').exists()).toBe(true);
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
    // первая кнопка создания — в группе Todo; нужна Done (вторая)
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
    await until(() => w.text().includes('Ann')); // справочники подгружаются отдельно
    await create('by ann');
    const t = await poll(async () =>
      (await db.table('tasks').toArray()).find((x) => x.title === 'by ann'),
    );
    const a = await db.table('taskAssignees').where('taskId').equals(t.id).toArray();
    expect(a.map((x) => x.userId)).toEqual([ids.ann]);
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
  it('list:bulk удаление с подтверждением', async () => {
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
    await key('j');
    expect(row('PLN-1').classes()).toContain('ring-2');
    await key('j');
    expect(row('PLN-2').classes()).toContain('ring-2');
    await key('k');
    expect(row('PLN-1').classes()).toContain('ring-2');
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
    await show({}, '[data-create], button');
    await w.get('button').trigger('click');
    const input = w.get('[data-create] input');
    await input.setValue('first');
    // справочники подгружаются отдельно: повторяем Enter, пока задача не создана
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
    const cb = row('PLN-1').get('input[type=checkbox]');
    await cb.setValue(true);
    expect(document.activeElement).toBe(grid.element);
    useSelection().clear();
    await row('PLN-1').get('button').trigger('keydown', { key: 'j' });
    await row('PLN-1').get('button').trigger('keydown', { key: 'x' });
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
    const tone = (k: string) => row(k).find('span.text-xs').classes();
    expect(tone('PLN-1')).toContain('text-danger');
    expect(tone('PLN-2')).toContain('text-warning');
    expect(tone('PLN-3')).toContain('text-fg-muted');
  });
  it('list:row без меток, срока и исполнителей лишнего нет; пикеры не ловят клики', async () => {
    await db.table('tasks').put(task(1));
    await show();
    const r = row('PLN-1');
    expect(r.find('span.text-xs').exists()).toBe(false);
    expect(r.find('div.absolute').classes()).toContain('pointer-events-none');
  });
});
