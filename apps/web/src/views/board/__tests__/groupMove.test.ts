import 'fake-indexeddb/auto';
import { mount } from '@vue/test-utils';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { domainMutators } from '@planar/shared';
import en from '../../../i18n/en';
import ru from '../../../i18n/ru';
import { db, registerMutators, startSync, stopSync } from '../../../sync';
import { ids, reset, task, until } from '../../../tasks/__tests__/data';
import { toasts } from '../../../ui/toast';
import { api, ApiError } from '../../../api/http';
import { useSelection, type ViewOptions } from '../..';
import View from '../View.vue';
import Column from '../Column.vue';
import { dragGroup, dropRanks, planGroupMove, settled, withPatch } from '../groupMove';
import type { TaskGroup } from '../../../tasks';

vi.mock('../../../api/http', async (orig) => ({
  ...(await orig<object>()),
  api: vi.fn(),
}));

const col = (key: string, idsIn: string[]) =>
  ({ key, label: key, tasks: idsIn.map((id) => ({ id })) }) as unknown as TaskGroup;
const placed = (id: string, statusId: string, rank: string) => ({ id, statusId, rank });
const order = (tasks: { id: string; statusId: string; rank: string }[], statusId: string) =>
  tasks
    .filter((t) => t.statusId === statusId)
    .sort((a, b) => (a.rank < b.rank ? -1 : 1))
    .map((t) => t.id);
const applied = (
  tasks: { id: string; statusId: string; rank: string }[],
  plan: ReturnType<typeof planGroupMove>,
) => withPatch(tasks, plan!.patch);

describe('PLNRAPP-293 групповой перенос: расчёт', () => {
  it('выделенная карточка тащит все выделенные в порядке доски, невыделенная — только себя', () => {
    const cols = [col('todo', ['a', 'b', 'c']), col('done', ['d', 'e'])];
    const sel = new Set(['e', 'a', 'c']);
    expect(dragGroup(cols, 'c', sel)).toEqual(['a', 'c', 'e']);
    expect(dragGroup(cols, 'b', sel)).toEqual(['b']);
    expect(dragGroup(cols, 'x', new Set(['x']))).toEqual(['x']); // выделена, но не на доске
  });

  const board = () => [
    placed('a', 'todo', 'a1'),
    placed('b', 'todo', 'a2'),
    placed('c', 'todo', 'a3'),
    placed('d', 'done', 'a1'),
    placed('e', 'done', 'a2'),
  ];

  it('между колонками: группа подряд в точке сброса, исходный порядок', () => {
    const t = board();
    const plan = planGroupMove(t, ['a', 'c'], 'done', 'e')!;
    expect(plan.before).toBe('e');
    const after = applied(t, plan);
    expect(order(after, 'done')).toEqual(['d', 'a', 'c', 'e']);
    expect(order(after, 'todo')).toEqual(['b']);
    expect(plan.patch.get('a')).toMatchObject({ statusId: 'done' });
  });

  it('в конец колонки и в пустую колонку', () => {
    const t = board();
    const end = planGroupMove(t, ['c', 'a'], 'done', null)!;
    expect(end.before).toBeNull();
    expect(order(applied(t, end), 'done')).toEqual(['d', 'e', 'c', 'a']);
    const empty = planGroupMove(t, ['a', 'd'], 'new', null)!;
    expect(order(applied(t, empty), 'new')).toEqual(['a', 'd']);
  });

  it('внутри колонки, якорь — одна из переносимых: перед следующей оставшейся', () => {
    const t = [...board(), placed('f', 'todo', 'a4')];
    const plan = planGroupMove(t, ['a', 'c'], 'todo', 'c')!;
    expect(plan.before).toBe('f');
    expect(order(applied(t, plan), 'todo')).toEqual(['b', 'a', 'c', 'f']);
    // разбросанные выделенные собираются у точки сброса
    const gather = planGroupMove(t, ['a', 'f'], 'todo', 'b')!;
    expect(order(applied(t, gather), 'todo')).toEqual(['a', 'f', 'b', 'c']);
  });

  it('группа уже стоит подряд на этом месте — плана нет', () => {
    const t = board();
    expect(planGroupMove(t, ['a', 'b'], 'todo', 'c')).toBeNull();
    expect(planGroupMove(t, ['a', 'b'], 'todo', 'a')).toBeNull();
    expect(planGroupMove(t, ['b', 'a'], 'todo', 'c')).not.toBeNull(); // другой порядок
  });

  it('соседи с одинаковым rank переранжированы, группа встаёт ровно в точку сброса', () => {
    const t = [placed('x', 's', 'a1'), placed('y', 's', 'a1'), placed('z', 's', 'a1')];
    const plan = planGroupMove([...t, placed('m', 'o', 'a0')], ['m'], 's', 'y')!;
    const after = applied([...t, placed('m', 'o', 'a0')], plan);
    expect(order(after, 's')).toEqual(['x', 'm', 'y', 'z']);
    expect(dropRanks([], 0, 3).ranks).toHaveLength(3);
  });

  it('settled: изменения, которые уже есть в реплике', () => {
    const patch = new Map([
      ['a', { statusId: 'done', rank: 'b1' }],
      ['b', { rank: 'b2' }],
    ]);
    expect(settled([placed('a', 'done', 'b1'), placed('b', 'todo', 'a2')], patch)).toEqual(['a']);
  });
});

const i18n = createI18n({
  legacy: false,
  locale: 'ru',
  fallbackLocale: 'ru',
  messages: { ru, en },
});
const options = {
  groupBy: 'status' as const,
  sortBy: 'rank' as const,
  sortDir: 'asc' as const,
  showSubtasks: false,
  fields: ['status'] as ViewOptions['fields'],
};

describe('PLNRAPP-293 групповой перенос на Доске', () => {
  beforeAll(() => registerMutators(domainMutators));
  beforeEach(async () => {
    await stopSync();
    await reset();
    await startSync({
      userId: ids.ann,
      fetch: (() => Promise.reject(new TypeError('offline'))) as never,
    });
    await db._queue.clear();
    vi.mocked(api).mockReset();
    toasts.value = [];
    useSelection().clear();
  });

  const setup = async () => {
    const ts = [1, 2, 3].map((n) => task(n));
    await db.table('tasks').bulkPut(ts);
    const w = mount(View, {
      props: { projectId: ids.project, options },
      global: { plugins: [i18n] },
    });
    await until(() => w.findAll('article').length === 3);
    const titles = (status: string) =>
      w.findAll(`[data-column="${status}"] article`).map((a) => a.text().trim().slice(-2));
    const emitMove = (id: string, to: string, beforeId: string | null) =>
      w
        .findAllComponents(Column)
        .find((c) => c.props('group').key === ids.todo)!
        .vm.$emit('move', id, ids.todo, to, beforeId);
    return { w, ts, titles, emitMove };
  };

  it('выделенная карточка: бейдж «+N», вся группа сразу в колонке, затем API', async () => {
    const { w, ts, titles, emitMove } = await setup();
    const sel = useSelection();
    sel.set([ts[0]!.id, ts[2]!.id]);
    await until(() => w.findAll('[data-testid=drag-count]').length === 2);
    expect(w.get('[data-testid=drag-count]').text()).toBe('+1');
    let answer!: (v: unknown) => void;
    vi.mocked(api).mockReturnValue(new Promise((r) => (answer = r)));
    emitMove(ts[2]!.id, ids.done, null);
    await until(() => titles(ids.done).length === 2);
    expect(titles(ids.done)).toEqual(['t1', 't3']);
    expect(titles(ids.todo)).toEqual(['t2']);
    expect(api).toHaveBeenCalledWith('POST', '/api/v1/tasks/move', {
      taskIds: [ts[0]!.id, ts[2]!.id],
      statusId: ids.done,
      before: null,
    });
    answer({ data: [] });
    expect(sel.selected.value.size).toBe(2); // выделение остаётся
    w.unmount();
  });

  it('ошибка API — доска откатывается и показывает сообщение', async () => {
    const { w, ts, titles, emitMove } = await setup();
    useSelection().set([ts[0]!.id, ts[1]!.id]);
    vi.mocked(api).mockRejectedValue(
      new ApiError(409, 'conflict', 'Задачи не перенесены: проблемных 1', {
        tasks: [{ task: ts[1]!.id, code: 'archived', message: 'задача в архиве' }],
      }),
    );
    emitMove(ts[0]!.id, ids.done, null);
    await until(() => toasts.value.length === 1);
    expect(toasts.value[0]!.text).toBe('Задачи не перенесены (2): PLN-2 — задача в архиве');
    await until(() => titles(ids.todo).length === 3);
    expect(titles(ids.done)).toEqual([]);
    w.unmount();
  });

  it('невыделенная карточка: выделение сброшено, переносится только она', async () => {
    const { w, ts } = await setup();
    const sel = useSelection();
    sel.set([ts[0]!.id, ts[1]!.id]);
    const todo = w.findAllComponents(Column).find((c) => c.props('group').key === ids.todo)!;
    todo.vm.$emit('dragStart', ts[2]!.id);
    expect(sel.selected.value.size).toBe(0);
    todo.vm.$emit('move', ts[2]!.id, ids.todo, ids.done, null);
    await until(async () => (await db.table('tasks').get(ts[2]!.id))?.statusId === ids.done);
    expect(api).not.toHaveBeenCalled();
    w.unmount();
  });
});
