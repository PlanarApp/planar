import 'fake-indexeddb/auto';
import { effectScope, nextTick, ref, watch } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Row } from '@planar/shared';
import { db } from '../../../sync';
import { id, ids, reset, T } from '../../../tasks/__tests__/data';
import { MY_DAY_FILTER } from '../../../inbox/myDay';
import type { Filter } from '../../filter';
import { useNodeViewDraft } from '../nodeView';
import { useTaskFilter } from '../useFilter';

// PLNRAPP-883: при переключении списков («Мой день» → «Назначенные» и др.) вид монтируется заново;
// пока статусы и сохранённый вид не прочитаны, завершённые задачи не должны проскакивать
const open = { id: 'open', statusId: ids.todo, assigneeIds: [], dueDate: '2026-01-01' };
const done = { id: 'done', statusId: ids.done, assigneeIds: [], dueDate: '2026-01-01' };
const HIDE_CLOSED: Filter = {
  op: 'and',
  rules: [{ field: 'statusCategory', operator: 'notIn', value: ['done', 'cancelled'] }],
};

beforeEach(reset);

describe('PLNRAPP-883: useTaskFilter до загрузки статусов', () => {
  const statusRows = () => db.table<Row<'statuses'>>('statuses').toArray();
  const run = (filter: Filter | null, me: 'mine' | null = null) => {
    const statuses = ref<Row<'statuses'>[] | undefined>(undefined);
    const scope = effectScope();
    const pred = scope.run(() => useTaskFilter(filter, statuses, me))!;
    const pick = () => [open, done].filter((x) => pred.value(x as never)).map((x) => x.id);
    return { statuses, pick, stop: () => scope.stop() };
  };

  it('правило категории статуса: без статусов — ни одной задачи, со статусами — только открытые', async () => {
    const f = run(HIDE_CLOSED);
    expect(f.pick()).toEqual([]);
    f.statuses.value = await statusRows();
    expect(f.pick()).toEqual(['open']);
    f.stop();
  });

  it('фильтр «Моего дня» не пропускает завершённую задачу, пока статусы грузятся', async () => {
    const f = run({
      ...MY_DAY_FILTER,
      rules: MY_DAY_FILTER.rules.filter((r) => r.field !== 'assignee'),
    });
    expect(f.pick()).not.toContain('done');
    f.statuses.value = await statusRows();
    expect(f.pick()).toEqual(['open']);
    f.stop();
  });

  it('Me Mode «мои»: без статусов закрытые неизвестны — ни одной задачи', async () => {
    const f = run(null, 'mine');
    expect(f.pick()).toEqual([]);
    f.stop();
  });

  it('фильтр без правил статуса не ждёт статусов (показ завершённых как раньше)', () => {
    const f = run(null);
    expect(f.pick()).toEqual(['open', 'done']);
    f.stop();
  });
});

describe('PLNRAPP-883: useNodeViewDraft — вид не рисуется до чтения сохранённых настроек', () => {
  it('ready=false, пока строка не прочитана; с ready=true фильтр уже сохранённый, не пустой', async () => {
    const node = `p:${ids.project}`;
    await db.table('savedViews').put({
      id: id(),
      spaceId: ids.space,
      userId: null,
      createdBy: ids.ann,
      name: 'list',
      layout: 'list',
      node,
      filter: HIDE_CLOSED,
      config: {},
      rank: 'a1',
      createdAt: T,
      updatedAt: T,
    });
    const scope = effectScope();
    const view = scope.run(() => useNodeViewDraft({ spaceId: ids.space, node, layout: 'list' }))!;
    // каждое состояние, в котором вид был бы нарисован (ready), — с сохранённым фильтром
    const drawn: (Filter | null)[] = [];
    scope.run(() =>
      watch(
        [view.ready, view.filter],
        () => {
          if (view.ready.value) drawn.push(view.filter.value);
        },
        { immediate: true },
      ),
    );
    expect(view.ready.value).toBe(false);
    await vi.waitFor(() => expect(view.ready.value).toBe(true));
    await nextTick();
    expect(drawn.length).toBeGreaterThan(0);
    for (const f of drawn) expect(f).toEqual(HIDE_CLOSED);
    scope.stop();
  });
});
