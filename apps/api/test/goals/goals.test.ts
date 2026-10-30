import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7, type FilterCtx, type FilterTask } from '@planar/shared';
import {
  goalProgress,
  krProgress,
  milestoneProgress,
  type KeyResult,
} from '@planar/module-goals/shared';
import {
  goalsGoals,
  goalsKeyResults,
  goalsMilestones,
  goalsMilestoneTasks,
} from '@planar/module-goals/api/schema';
import * as schema from '../../src/db/schema.js';
import { key, newDb, taskArgs, world, type World } from '../sync/helpers.js';

// ---- pure functions ----
const st = (category: string) => ({ id: category, category }) as never;
const ctx: FilterCtx = {
  statuses: ['backlog', 'todo', 'in_progress', 'done', 'cancelled'].map(st),
  userId: 'u',
  today: '2026-10-25',
};
const P1 = uuidv7();
const P2 = uuidv7();
const task = (category: string, over: Partial<FilterTask> = {}) =>
  ({
    id: uuidv7(),
    projectId: P1,
    statusId: category,
    title: 't',
    priority: 0,
    assigneeIds: [],
    labelIds: [],
    ...over,
  }) as unknown as FilterTask;
const tasksKr = (projectIds: string[], filter: unknown = { op: 'and', rules: [] }) =>
  ({ kind: 'tasks', metric: null, filter: { projectIds, filter } }) as unknown as KeyResult;
const numKr = (start: number, target: number, current: number) =>
  ({ kind: 'number', filter: null, metric: { start, target, current, unit: null } }) as KeyResult;

describe('pf3: прогресс', () => {
  it('pf3: number — доля шкалы с зажимом 0–1, убывающая шкала', () => {
    expect(krProgress(numKr(0, 100, 25), [], ctx)).toBe(0.25);
    expect(krProgress(numKr(0, 100, 250), [], ctx)).toBe(1);
    expect(krProgress(numKr(0, 100, -5), [], ctx)).toBe(0);
    expect(krProgress(numKr(100, 0, 75), [], ctx)).toBe(0.25);
  });

  it('pf3: tasks — done / (все без cancelled), нет задач — 0', () => {
    const ts = [task('done'), task('todo'), task('cancelled'), task('done')];
    expect(krProgress(tasksKr([]), ts, ctx)).toBeCloseTo(2 / 3);
    expect(krProgress(tasksKr([]), [], ctx)).toBe(0);
    expect(krProgress(tasksKr([]), [task('cancelled')], ctx)).toBe(0);
  });

  it('pf3: tasks — projectIds и F-filter', () => {
    const ts = [task('done'), task('todo', { projectId: P2 }), task('done', { priority: 3 })];
    expect(krProgress(tasksKr([P2]), ts, ctx)).toBe(0);
    expect(krProgress(tasksKr([P1]), ts, ctx)).toBe(1);
    const f = { op: 'and', rules: [{ field: 'priority', operator: 'in', value: [3] }] };
    expect(krProgress(tasksKr([], f), ts, ctx)).toBe(1);
    const g = { op: 'and', rules: [{ field: 'statusCategory', operator: 'in', value: ['todo'] }] };
    expect(krProgress(tasksKr([], g), ts, ctx)).toBe(0);
  });

  it('pf3: goalProgress — среднее, нет KR — null', () => {
    expect(goalProgress([])).toBeNull();
    expect(goalProgress([0.5, 1])).toBe(0.75);
  });

  it('pf3: milestoneProgress — счётчики и доля без cancelled', () => {
    const r = milestoneProgress(
      (['done', 'done', 'todo', 'cancelled'] as const).map((category) => ({ category })),
    );
    expect(r.counts).toMatchObject({ done: 2, todo: 1, cancelled: 1, backlog: 0 });
    expect(r.done).toBeCloseTo(2 / 3);
    expect(milestoneProgress([]).done).toBe(0);
    expect(milestoneProgress([{ category: 'cancelled' }]).done).toBe(0);
  });
});

// ---- mutators and hooks ----
const db = newDb();
let w: World;
beforeAll(async () => {
  w = await world(db);
  await db
    .insert(schema.settings)
    .values({ id: 'enabled_modules', value: ['goals'] })
    .onConflictDoUpdate({ target: schema.settings.id, set: { value: ['goals'] } });
});
afterAll(() => db.$client.end());

const mkTask = async (projectId = w.projectId) => {
  const a = taskArgs(w, { projectId });
  await w.admin.ok('task.create', a);
  return a.id as string;
};
const mkMs = async (projectId = w.projectId) => {
  const id = uuidv7();
  await w.member.ok('goals.milestone.create', { id, projectId, name: 'M', date: '2026-11-01' });
  return id;
};
const links = (taskId: string) =>
  db.select().from(goalsMilestoneTasks).where(eq(goalsMilestoneTasks.taskId, taskId));
const err = (r: unknown) => JSON.stringify(r);

describe('pf3: вехи', () => {
  it('pf3: create берёт spaceId из проекта, update меняет поля', async () => {
    const id = await mkMs();
    await w.member.ok('goals.milestone.update', { id, name: 'N', description: 'd' });
    const [r] = await db.select().from(goalsMilestones).where(eq(goalsMilestones.id, id));
    expect(r).toMatchObject({
      spaceId: w.spaceId,
      name: 'N',
      description: 'd',
      date: '2026-11-01',
    });
  });

  it('pf3: setTask переносит задачу (одна строка), null убирает', async () => {
    const [a, b, t] = [await mkMs(), await mkMs(), await mkTask()];
    await w.member.ok('goals.milestone.setTask', { id: uuidv7(), taskId: t, milestoneId: a });
    const [first] = await links(t);
    await w.member.ok('goals.milestone.setTask', { id: uuidv7(), taskId: t, milestoneId: b });
    const after = await links(t);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: first.id, milestoneId: b });
    await w.member.ok('goals.milestone.setTask', { id: uuidv7(), taskId: t, milestoneId: null });
    expect(await links(t)).toHaveLength(0);
  });

  it('pf3: setTask — задача чужого проекта → invalid_args', async () => {
    const p2 = uuidv7();
    await w.admin.ok('project.create', {
      id: p2,
      spaceId: w.spaceId,
      name: 'Q',
      key: key(),
      rank: 'a1',
    });
    const r = await w.member.push('goals.milestone.setTask', {
      id: uuidv7(),
      taskId: await mkTask(p2),
      milestoneId: await mkMs(),
    });
    expect(err(r)).toContain('invalid_args');
  });

  it('pf3: milestone.delete удаляет связи', async () => {
    const [m, t] = [await mkMs(), await mkTask()];
    await w.member.ok('goals.milestone.setTask', { id: uuidv7(), taskId: t, milestoneId: m });
    await w.member.ok('goals.milestone.delete', { id: m });
    expect(await links(t)).toHaveLength(0);
  });

  it('pf3: хук — удаление задачи и смена проекта убирают связь', async () => {
    const m = await mkMs();
    const [t1, t2] = [await mkTask(), await mkTask()];
    for (const taskId of [t1, t2])
      await w.member.ok('goals.milestone.setTask', { id: uuidv7(), taskId, milestoneId: m });
    await w.admin.ok('task.delete', { id: t1 });
    expect(await links(t1)).toHaveLength(0);
    const p2 = uuidv7();
    await w.admin.ok('project.create', {
      id: p2,
      spaceId: w.spaceId,
      name: 'R',
      key: key(),
      rank: 'a2',
    });
    await w.admin.ok('task.update', { id: t2, projectId: p2 });
    expect(await links(t2)).toHaveLength(0);
  });
});

describe('pf3: цели и ключевые результаты', () => {
  const goal = async (over: Record<string, unknown> = {}) => {
    const id = uuidv7();
    const r = await w.member.push('goals.goal.create', {
      id,
      spaceId: w.spaceId,
      name: 'G',
      rank: 'a0',
      ...over,
    });
    return { id, r };
  };

  it('pf3: goal.create — createdBy и проверка ownerId', async () => {
    const ok = await goal({ ownerId: w.admin.userId });
    expect(ok.r).toMatchObject({ ok: true });
    const [g] = await db.select().from(goalsGoals).where(eq(goalsGoals.id, ok.id));
    expect(g).toMatchObject({ createdBy: w.member.userId, ownerId: w.admin.userId });
    expect(err((await goal({ ownerId: w.outsider.userId })).r)).toContain('invalid_args');
  });

  it('pf3: kr.create — валидация metric/filter, kind неизменяем', async () => {
    const { id: goalId } = await goal();
    const kr = (over: Record<string, unknown>) =>
      w.member.push('goals.kr.create', { id: uuidv7(), goalId, name: 'K', rank: 'a0', ...over });
    const m = { start: 0, target: 10, current: 0, unit: null };
    expect(err(await kr({ kind: 'number' }))).toContain('invalid_args');
    expect(err(await kr({ kind: 'tasks' }))).toContain('invalid_args');
    expect(err(await kr({ kind: 'number', metric: { ...m, target: 0 } }))).toContain(
      'invalid_args',
    );
    expect(await kr({ kind: 'number', metric: m })).toMatchObject({ ok: true });
    const id = uuidv7();
    await w.member.ok('goals.kr.create', {
      id,
      goalId,
      name: 'T',
      kind: 'tasks',
      rank: 'a1',
      filter: { projectIds: [], filter: { op: 'and', rules: [] } },
    });
    expect(err(await w.member.push('goals.kr.update', { id, metric: m }))).toContain(
      'invalid_args',
    );
    await w.member.ok('goals.kr.update', { id, name: 'T2' });
  });

  it('pf3: goal.delete удаляет ключевые результаты', async () => {
    const { id: goalId } = await goal();
    await w.member.ok('goals.kr.create', {
      id: uuidv7(),
      goalId,
      name: 'K',
      kind: 'number',
      rank: 'a0',
      metric: { start: 0, target: 1, current: 0, unit: null },
    });
    await w.member.ok('goals.goal.delete', { id: goalId });
    expect(
      await db.select().from(goalsKeyResults).where(eq(goalsKeyResults.goalId, goalId)),
    ).toHaveLength(0);
  });
});
