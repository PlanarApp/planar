import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@planar/shared';
import type { PlanarDB } from '../../../sync/db';
import { burnup } from '../../../../../../modules/sprints/web/burnup';
import CyclePanel from '../../../../../../modules/sprints/web/CyclePanel.vue';
import SprintView from '../../../../../../modules/sprints/web/SprintView.vue';
import * as shared from '../../../../../../modules/sprints/shared/index';

const mutate = vi.hoisted(() => vi.fn(async () => {}));
const h = vi.hoisted(() => ({ db: undefined as unknown as PlanarDB }));
vi.mock('../../../sync', async () => {
  const { PlanarDB } = await import('../../../sync/db');
  const { useQuery } = await import('../../../sync/query');
  h.db = new PlanarDB('wk2', {
    sprintsCycles: ['spaceId', 'projectId'],
    sprintsSettings: ['projectId'],
  });
  return { db: h.db, mutate, registerMutators: vi.fn(), useQuery, newId: () => 'new-id' };
});
const S = { todo: uuidv7(), prog: uuidv7(), done: uuidv7() };
vi.mock('../../../tasks', () => ({
  useStatuses: () =>
    ref([
      { id: S.todo, category: 'todo' },
      { id: S.prog, category: 'in_progress' },
      { id: S.done, category: 'done' },
    ]),
}));

const mod = async () => ({ burnup, SprintView, CyclePanel, shared });

const P = uuidv7();
const SP = uuidv7();
const T = '2026-10-20T10:00:00.000Z';
const day = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const cycleRow = (over: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  spaceId: SP,
  projectId: P,
  number: 1,
  name: null,
  startDate: day(-1),
  endDate: day(5),
  closedAt: null,
  createdAt: T,
  updatedAt: T,
  ...over,
});
const settingsRow = (over: Record<string, unknown> = {}) => ({
  id: P,
  spaceId: SP,
  projectId: P,
  enabled: true,
  lengthDays: 14,
  timezone: 'UTC',
  autoCreate: true,
  createdAt: T,
  updatedAt: T,
  ...over,
});
const task = (statusId: string, cycleId: string | null, completedAt: string | null = null) => ({
  id: uuidv7(),
  spaceId: SP,
  projectId: P,
  statusId,
  cycleId,
  completedAt,
});

beforeAll(async () => {
  await mod(); // создаёт h.db
  await h.db.open();
});
beforeEach(async () => {
  mutate.mockClear();
  await Promise.all(h.db.tables.map((t) => t.clear()));
});
afterEach(() => vi.useRealTimers());

describe('wk2: burn-up', () => {
  it('wk2: done нарастающим итогом по дням цикла, будущее — null, пояс проекта учтён', async () => {
    const { burnup } = await mod();
    const b = burnup(
      { startDate: '2026-10-01', endDate: '2026-10-04' },
      [
        { completedAt: '2026-10-01T10:00:00Z' },
        { completedAt: '2026-10-02T09:00:00Z' },
        // 23:30 UTC 2-го — в Токио уже 3-е
        { completedAt: '2026-10-02T23:30:00Z' },
        { completedAt: null },
      ],
      '2026-10-03',
      'Asia/Tokyo',
    );
    expect(b.scope).toBe(4);
    expect(b.days).toHaveLength(4);
    // Токио: 1-е 19:00 (1-е), 2-е 18:00 (2-е), 3-е 08:30 (3-е)
    expect(b.done).toEqual([1, 2, 3, null]);
  });
});

describe('wk2: вид «Спринт»', () => {
  it('wk2: без настроек — кнопка включения вызывает sprints.configure с часовым поясом', async () => {
    const { SprintView } = await mod();
    const w = mount(SprintView, { props: { projectId: P } });
    await vi.waitFor(() => expect(w.find('[data-role=enable]').exists()).toBe(true));
    await w.get('[data-role=enable]').trigger('click');
    expect(mutate).toHaveBeenCalledWith(
      'sprints.configure',
      expect.objectContaining({ projectId: P, enabled: true, timezone: expect.any(String) }),
    );
  });

  it('wk2: показывает прогресс по категориям статусов и burn-up текущего цикла', async () => {
    const { SprintView } = await mod();
    const c = cycleRow();
    await h.db.table('sprintsSettings').put(settingsRow());
    await h.db
      .table('sprintsCycles')
      .bulkPut([c, cycleRow({ number: 2, startDate: day(6), endDate: day(12) })]);
    await h.db
      .table('tasks')
      .bulkPut([
        task(S.todo, c.id),
        task(S.prog, c.id),
        task(S.done, c.id, new Date().toISOString()),
        task(S.done, c.id, new Date().toISOString()),
        task(S.todo, null),
      ]);
    const w = mount(SprintView, { props: { projectId: P } });
    await vi.waitFor(() => expect(w.find('[data-testid=sprint-current]').exists()).toBe(true));
    await vi.waitFor(() => expect(w.get('[data-count=done]').text()).toContain('2'));
    expect(w.get('[data-count=todo]').text()).toContain('1');
    expect(w.get('[data-count=in_progress]').text()).toContain('1');
    expect(w.get('[data-count=cancelled]').text()).toContain('0');
    expect(w.text()).toContain('50%');
    expect(w.find('[data-testid=burnup] polyline').exists()).toBe(true);
  });

  it('wk2: «Закрыть» вызывает sprints.close для текущего цикла', async () => {
    const { SprintView } = await mod();
    const c = cycleRow();
    await h.db.table('sprintsSettings').put(settingsRow());
    await h.db.table('sprintsCycles').put(c);
    const w = mount(SprintView, { props: { projectId: P } });
    await vi.waitFor(() => expect(w.find('[data-role=close]').exists()).toBe(true));
    await w.get('[data-role=close]').trigger('click');
    expect(mutate).toHaveBeenCalledWith('sprints.close', { id: c.id, nextId: 'new-id' });
  });

  it('wk2: без текущего цикла — заглушка и создание цикла со следующего дня после последнего', async () => {
    const { SprintView } = await mod();
    const old = cycleRow({ startDate: day(-30), endDate: day(-20), closedAt: T });
    await h.db.table('sprintsSettings').put(settingsRow());
    await h.db.table('sprintsCycles').put(old);
    const w = mount(SprintView, { props: { projectId: P } });
    await vi.waitFor(() => expect(w.find('[data-testid=sprint-none]').exists()).toBe(true));
    await w.get('[data-role=create]').trigger('click');
    expect(mutate).toHaveBeenCalledWith(
      'sprints.create',
      expect.objectContaining({ projectId: P, id: 'new-id' }),
    );
  });
});

describe('wk2: поле «Спринт» в панели задачи', () => {
  it('wk2: выбор цикла и «Без спринта» вызывают sprints.setTask', async () => {
    const { CyclePanel } = await mod();
    const c = cycleRow();
    const closed = cycleRow({ number: 0, closedAt: T });
    await h.db.table('sprintsCycles').bulkPut([c, closed]);
    const t = task(S.todo, null);
    await h.db.table('tasks').put(t);
    const w = mount(CyclePanel, { props: { taskId: t.id } });
    await vi.waitFor(() => expect(w.findAll('option')).toHaveLength(2)); // закрытый скрыт
    await w.get('[data-role=cycle]').setValue(c.id);
    expect(mutate).toHaveBeenLastCalledWith('sprints.setTask', { taskId: t.id, cycleId: c.id });
    await w.get('[data-role=cycle]').setValue('');
    expect(mutate).toHaveBeenLastCalledWith('sprints.setTask', { taskId: t.id, cycleId: null });
    await flushPromises();
  });
});

describe('wk2: shared', () => {
  it('wk2: схемы сущностей принимают строки модуля', async () => {
    const { shared } = await mod();
    expect(shared.sprintsCycles.safeParse(cycleRow()).success).toBe(true);
    expect(shared.sprintsSettings.safeParse(settingsRow()).success).toBe(true);
    expect(shared.sprintsSettings.safeParse(settingsRow({ lengthDays: 61 })).success).toBe(false);
  });
});
