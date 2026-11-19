import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: [string, unknown][] = [];
vi.mock('../../sync', () => ({
  mutate: vi.fn(async (name: string, input: unknown) => void calls.push([name, input])),
}));
vi.mock('../../tasks', () => ({
  setAssignees: vi.fn(
    async (id: string, ids: string[]) => void calls.push(['assign', { id, ids }]),
  ),
  setLabels: vi.fn(async (id: string, ids: string[]) => void calls.push(['labels', { id, ids }])),
}));
vi.mock('../board/plan', () => ({
  swap: (cur: string[], from: string, to: string) =>
    to === 'none'
      ? cur.filter((v) => v !== from)
      : [...new Set([...cur.filter((v) => v !== from), to])],
}));
const toasts: string[] = [];
vi.mock('../../ui/toast', () => ({ toast: (s: string) => void toasts.push(s) }));

import {
  dragSet,
  dropAnchor,
  groupRanks,
  moveGroupApi,
  moveGroupLocal,
  GROUP_MOVE_MAX,
} from '../groupMove';

beforeEach(() => {
  calls.length = 0;
  toasts.length = 0;
  vi.unstubAllGlobals();
});

describe('PLNRAPP-294 групповой drag-n-drop: состав группы', () => {
  const order = ['a', 'b', 'c', 'd', 'b'];
  it('выделенная задача тянет все выделенные в порядке вида', () => {
    expect(dragSet(new Set(['d', 'b']), 'd', order)).toEqual(['b', 'd']);
  });
  it('невыделенная или единственная выделенная — только она', () => {
    expect(dragSet(new Set(['b', 'd']), 'a', order)).toEqual(['a']);
    expect(dragSet(new Set(['a']), 'a', order)).toEqual(['a']);
    expect(dragSet(new Set(), 'a', order)).toEqual(['a']);
  });
});

describe('PLNRAPP-294 групповой drag-n-drop: точка сброса', () => {
  const row = (group: string, id: string) => ({ kind: 'task' as const, group, task: { id } });
  it('якорь — первая непереносимая задача целевой группы', () => {
    const rows = [row('g1', 'a'), row('g1', 'b'), row('g1', 'c')];
    expect(dropAnchor(rows, 'g1', new Set(['a', 'b']))).toBe('c');
  });
  it('конец группы (строка создания, другая группа) — null', () => {
    expect(dropAnchor([row('g1', 'a'), { kind: 'create' }], 'g1', new Set(['a']))).toBeNull();
    expect(dropAnchor([row('g2', 'x')], 'g1', new Set())).toBeNull();
    expect(dropAnchor([], 'g1', new Set())).toBeNull();
  });
});

describe('PLNRAPP-294 групповой drag-n-drop: ранги', () => {
  const col = [
    { id: 'x', rank: 'a1' },
    { id: 'y', rank: 'a3' },
  ];
  it('задачи встают подряд между соседями', () => {
    const { ranks, rerank } = groupRanks(col, 'y', 3);
    expect(ranks).toHaveLength(3);
    expect(rerank).toEqual([]);
    expect(['a1', ...ranks, 'a3']).toEqual([...['a1', ...ranks, 'a3']].sort());
    expect(new Set(ranks).size).toBe(3);
  });
  it('без якоря — в конец, в пустую группу — тоже', () => {
    const { ranks } = groupRanks(col, null, 2);
    expect(ranks[0]! > 'a3' && ranks[1]! > ranks[0]!).toBe(true);
    expect(groupRanks([], null, 2).ranks).toHaveLength(2);
  });
  it('повторы рангов: задачи после точки сброса получают ранги после переносимых', () => {
    const dup = [
      { id: 'x', rank: 'a1' },
      { id: 'y', rank: 'a1' },
      { id: 'z', rank: 'a5' },
    ];
    const { ranks, rerank } = groupRanks(dup, 'y', 2);
    expect(rerank.map(([id]) => id)).toEqual(['y']);
    const all = ['a1', ...ranks, rerank[0]![1], 'a5'];
    expect(all).toEqual([...all].sort());
  });
});

describe('PLNRAPP-294 групповой перенос через API', () => {
  it('один запрос атомарного переноса: задачи по порядку, статус, якорь', async () => {
    const fetch = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await moveGroupApi(['b', 'a'], 's2', 'c')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/tasks/move');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      taskIds: ['b', 'a'],
      statusId: 's2',
      before: 'c',
    });
    expect(toasts).toEqual([]);
    expect(calls).toEqual([]); // nothing local: the result comes by sync
  });
  it('ошибка API — ничего не меняется локально, пользователь видит причину', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ code: 'conflict', message: 'Задачи не перенесены: проблемных 1' }),
            { status: 409 },
          ),
      ),
    );
    expect(await moveGroupApi(['a', 'b'], 's2', null)).toBe(false);
    expect(calls).toEqual([]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toContain('проблемных 1');
  });
  it('PLNRAPP-295 частичный запрет: не переносится ничего, в сообщении ключ и причина по задаче', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 'conflict',
              message: 'Задачи не перенесены: проблемных 2',
              details: {
                tasks: [
                  { task: 'b', code: 'forbidden', message: 'нет прав' },
                  { task: 'c', code: 'archived', message: 'задача в архиве' },
                ],
              },
            }),
            { status: 409 },
          ),
      ),
    );
    const keys: Record<string, string> = { a: 'PLN-1', b: 'PLN-2', c: 'PLN-3' };
    expect(await moveGroupApi(['a', 'b', 'c'], 's2', null, (id) => keys[id]!)).toBe(false);
    expect(calls).toEqual([]);
    expect(toasts).toEqual([
      'Tasks were not moved: PLN-2 — нет прав; PLN-3 — задача в архиве',
    ]);
  });
  it('сеть недоступна — сообщение без технических подробностей', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(await moveGroupApi(['a', 'b'], 's2', null)).toBe(false);
    expect(toasts).toEqual(['Tasks were not moved']);
  });
  it('больше лимита сервера — запрос не уходит', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const ids = Array.from({ length: GROUP_MOVE_MAX + 1 }, (_, i) => `t${i}`);
    expect(await moveGroupApi(ids, 's', null)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(toasts).toHaveLength(1);
  });
});

describe('PLNRAPP-294 групповой перенос без статуса (приоритет, исполнитель, метка)', () => {
  const task = (id: string, o: Partial<{ priority: number; a: string[]; l: string[] }> = {}) => ({
    id,
    priority: o.priority ?? 0,
    assigneeIds: o.a ?? [],
    labelIds: o.l ?? [],
  });
  it('приоритет: меняется только у задач из другой группы, ранги — по порядку', async () => {
    await moveGroupLocal({
      tasks: [task('a', { priority: 2 }), task('b', { priority: 1 })],
      by: 'priority',
      from: (id) => (id === 'a' ? '2' : '1'),
      to: '1',
      ranks: ['r1', 'r2'],
      rerank: [['z', 'r3']],
    });
    expect(calls).toEqual([
      ['task.update', { id: 'z', rank: 'r3' }],
      ['task.update', { id: 'a', rank: 'r1', priority: 1 }],
      ['task.update', { id: 'b', rank: 'r2' }],
    ]);
  });
  it('исполнитель: из группы источника — в целевую', async () => {
    await moveGroupLocal({
      tasks: [task('a', { a: ['u1', 'u3'] })],
      by: 'assignee',
      from: () => 'u1',
      to: 'u2',
      ranks: ['r1'],
      rerank: [],
    });
    expect(calls).toEqual([
      ['assign', { id: 'a', ids: ['u3', 'u2'] }],
      ['task.update', { id: 'a', rank: 'r1' }],
    ]);
  });
  it('метка в сводке: ключи-имена переводятся в метки проекта задачи', async () => {
    await moveGroupLocal({
      tasks: [task('a', { l: ['l1'] })],
      by: 'label',
      from: () => 'l1',
      to: 'bug',
      ranks: ['r1'],
      rerank: [],
      fixLabels: (_, ls) => ls.map((x) => (x === 'bug' ? 'l9' : x)),
    });
    expect(calls[0]).toEqual(['labels', { id: 'a', ids: ['l9'] }]);
  });
});
