import type { ViewOptions } from '../..';
import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { domainMutators } from '@planar/shared';
import en from '../../../i18n/en';
import ru from '../../../i18n/ru';
import { i18n as appI18n } from '../../../i18n';
import { db, registerMutators, startSync, stopSync } from '../../../sync';
import { type GroupBy } from '../../../tasks';
import { ids, reset, task, until } from '../../../tasks/__tests__/data';
import View from '../View.vue';
import { applyMove, boardColumns, planMove } from '../plan';

vi.mock('../..', async (orig) => ({ ...(await orig<object>()), openTask: vi.fn() }));

const i18n = createI18n({
  legacy: false,
  locale: 'ru',
  fallbackLocale: 'ru',
  messages: { ru, en },
});
const options = (groupBy: GroupBy = 'status') => ({
  groupBy,
  sortBy: 'rank' as const,
  sortDir: 'asc' as const,
  showSubtasks: false,
  fields: ['status', 'assignee', 'priority', 'dueDate', 'labels'] as ViewOptions['fields'],
});

beforeAll(() => registerMutators(domainMutators));
beforeEach(async () => {
  localStorage.clear();
  await stopSync();
  await reset();
  await startSync({
    userId: ids.ann,
    fetch: (() => Promise.reject(new TypeError('offline'))) as never,
  });
  await db._queue.clear();
});

const ctx = async () => ({
  statuses: await db.table('statuses').toArray(),
  members: (await db.table('users').toArray()).filter((u) => !u.deactivatedAt),
  labels: await db.table('labels').toArray(),
});
async function columnsOf(by: GroupBy) {
  const tasks = (await db.table('tasks').toArray()).map((t) => ({
    ...t,
    key: `PLN-${t.number}`,
    assigneeIds: [] as string[],
    labelIds: [] as string[],
  }));
  for (const a of await db.table('taskAssignees').toArray())
    tasks.find((t) => t.id === a.taskId)?.assigneeIds.push(a.userId);
  return boardColumns(tasks, by, await ctx());
}
const mountView = (by: GroupBy = 'status') =>
  mount(View, {
    props: { projectId: ids.project, options: options(by) },
    global: { plugins: [i18n] },
  });

describe('board:columns', () => {
  it('board:columns по статусу — в порядке rank статусов, внутри по rank', async () => {
    await db.table('tasks').bulkPut([task(1, { rank: 'a2' }), task(2, { rank: 'a1' })]);
    const cols = await columnsOf('status');
    expect(cols.map((c) => c.key)).toEqual([ids.todo, ids.done]);
    expect(cols[0].tasks.map((t) => t.title)).toEqual(['t2', 't1']);
  });
  it('board:columns по исполнителю', async () => {
    const t = task(1);
    await db.table('tasks').put(t);
    await db.table('taskAssignees').put({ id: 'x', taskId: t.id, userId: ids.ann });
    const cols = await columnsOf('assignee');
    expect(cols.map((c) => c.key)).toEqual([ids.ann, 'none']);
  });
  it('board:columns по приоритету, DOM показывает заголовки и карточки', async () => {
    await db.table('tasks').bulkPut([task(1, { priority: 1 }), task(2, { priority: 3 })]);
    expect((await columnsOf('priority')).map((c) => c.key)).toEqual(['1', '2', '3', '4', '0']);
    const w = mountView('priority');
    await until(() => w.findAll('article').length === 2 || undefined);
    expect(w.findAll('section').map((s) => s.attributes('aria-label'))).toEqual(
      [1, 2, 3, 4, 0].map((p) => appI18n.global.t(`tasks.priority.${p}`)),
    );
  });
});

describe('board:move', () => {
  const setup = async () => {
    await db
      .table('tasks')
      .bulkPut([
        task(1, { rank: 'a1' }),
        task(2, { rank: 'a3' }),
        task(3, { rank: 'a5' }),
        task(4, { statusId: ids.done, rank: 'a2' }),
      ]);
    return columnsOf('status');
  };
  const byTitle = (cols: Awaited<ReturnType<typeof columnsOf>>, t: string) =>
    cols.flatMap((c) => c.tasks).find((x) => x.title === t)!;
  it('board:move внутри колонки — rank строго между соседями', async () => {
    const cols = await setup();
    const p = planMove(
      cols,
      'status',
      byTitle(cols, 't3').id,
      ids.todo,
      ids.todo,
      byTitle(cols, 't2').id,
    )!;
    expect(p).toMatchObject({ after: 'a1', before: 'a3' });
    expect(p.statusId).toBeUndefined();
    await applyMove(p);
    const r = (await db.table('tasks').get(p.id)).rank as string;
    expect(r > 'a1' && r < 'a3').toBe(true);
  });
  it('board:move в конец колонки', async () => {
    const cols = await setup();
    const p = planMove(cols, 'status', byTitle(cols, 't1').id, ids.todo, ids.todo, null)!;
    expect(p).toMatchObject({ after: 'a5', before: null });
  });
  it('board:move в другой статус — statusId и применение двигает строку', async () => {
    const cols = await setup();
    const t1 = byTitle(cols, 't1');
    const p = planMove(cols, 'status', t1.id, ids.todo, ids.done, null)!;
    expect(p).toMatchObject({ statusId: ids.done, after: 'a2', before: null });
    await applyMove(p);
    const row = await db.table('tasks').get(t1.id);
    expect(row.statusId).toBe(ids.done);
    expect(row.rank > 'a2').toBe(true);
  });
  it('board:move в колонку другого исполнителя — снять и добавить', async () => {
    const t = task(1);
    await db.table('tasks').put(t);
    await db.table('taskAssignees').put({ id: 'x', taskId: t.id, userId: ids.ann });
    const cols = boardColumns(
      [{ ...t, key: 'PLN-1', assigneeIds: [ids.ann], labelIds: [] }],
      'assignee',
      {
        ...(await ctx()),
        members: [
          { id: ids.ann, name: 'Ann' },
          { id: ids.bob, name: 'Bob' },
        ] as never,
      },
    );
    const p = planMove(cols, 'assignee', t.id, ids.ann, ids.bob, null)!;
    expect(p.assign).toEqual([ids.bob]);
    expect(planMove(cols, 'assignee', t.id, ids.ann, 'none', null)!.assign).toEqual([]);
    await applyMove(p);
    const rows = await db.table('taskAssignees').where('taskId').equals(t.id).toArray();
    expect(rows.map((r) => r.userId)).toEqual([ids.bob]);
  });
  it('board:move между приоритетами меняет priority', async () => {
    await db.table('tasks').bulkPut([task(1, { priority: 1 }), task(2, { priority: 3 })]);
    const cols = await columnsOf('priority');
    const t = cols[0].tasks[0];
    expect(cols[0].key).toBe('1');
    const p = planMove(cols, 'priority', t.id, '1', '3', null)!;
    expect(p.priority).toBe(3);
    await applyMove(p);
    expect((await db.table('tasks').get(t.id)).priority).toBe(3);
  });
});

describe('board:move многозначные', () => {
  const multi = async (by: 'assignee' | 'label') => {
    const a = by === 'assignee' ? ids.ann : ids.bug;
    const b = by === 'assignee' ? ids.bob : 'l-b';
    const c = by === 'assignee' ? 'u-c' : 'l-c';
    const t = task(1);
    const view = { ...t, key: 'PLN-1', assigneeIds: [] as string[], labelIds: [] as string[] };
    view[by === 'assignee' ? 'assigneeIds' : 'labelIds'] = [a, b];
    const base = await ctx();
    const cols = boardColumns([view], by, {
      ...base,
      members: [a, b, c].map((id) => ({ id, name: id })) as never,
      labels: [a, b, c].map((id) => ({ id, name: id, color: null })) as never,
    });
    return { cols, t, a, b, c, field: by === 'assignee' ? 'assign' : 'labels' } as const;
  };
  it('board:move перестановка во второй колонке не меняет связи', async () => {
    const { cols, t, b, field } = await multi('assignee');
    expect(planMove(cols, 'assignee', t.id, b, b, null)![field]).toBeUndefined();
  });
  it('board:move из A в C снимает A и добавляет C, B остаётся', async () => {
    const { cols, t, a, b, c } = await multi('assignee');
    expect(planMove(cols, 'assignee', t.id, a, c, null)!.assign).toEqual([b, c]);
  });
  it('board:move то же для меток', async () => {
    const { cols, t, a, b, c } = await multi('label');
    expect(planMove(cols, 'label', t.id, b, c, null)!.labels).toEqual([a, c]);
    expect(planMove(cols, 'label', t.id, b, b, null)!.labels).toBeUndefined();
  });
});

describe('board:collapse', () => {
  it('board:collapse состояние сохраняется в localStorage и восстанавливается', async () => {
    await db.table('tasks').put(task(1));
    const w = mountView();
    await until(() => w.findAll('article').length === 1 || undefined);
    await w.get('[data-testid=collapse]').trigger('click');
    expect(JSON.parse(localStorage.getItem(`planar.board.${ids.project}.collapsed`)!)).toEqual([
      ids.todo,
    ]);
    expect(w.findAll('article')).toHaveLength(0);
    expect(mountView().findAll('article')).toHaveLength(0);
  });
});

describe('board:create', () => {
  it('board:create быстрое добавление создаёт задачу в колонке в конец', async () => {
    await db.table('tasks').put(task(1, { rank: 'a1' }));
    const w = mountView();
    await until(() => w.findAll('article').length === 1 || undefined);
    await w.get('footer button').trigger('click');
    await w.get('footer input').setValue('Новая');
    await w.get('footer form').trigger('submit');
    await flushPromises();
    await until(() => w.findAll('article').length === 2 || undefined);
    const made = (await db.table('tasks').toArray()).find((t) => t.title === 'Новая');
    expect(made.statusId).toBe(ids.todo);
    expect(made.rank > 'a1').toBe(true);
  });
});

describe('board:virtual', () => {
  it('board:virtual колонка 5000 карточек — в DOM меньше 100', async () => {
    await db.table('tasks').bulkPut(Array.from({ length: 5000 }, (_, i) => task(i + 1)));
    const w = mountView();
    await until(() => w.findAll('article').length > 0 || undefined, 10000);
    expect(w.findAll('article').length).toBeLessThan(100);
  }, 30000);
});
