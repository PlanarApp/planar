import { describe, expect, it } from 'vitest';
import { uuidv7, matchFilter, type Filter, type FilterTask, type FilterCtx } from '../src/index';
import { id, mem, run, seedSpace, seedTask } from './mutators/helpers';

const C1 = uuidv7();
const C2 = uuidv7();
const P = uuidv7();
const base = { statuses: [], userId: 'u', today: '2026-10-23' };
const cycles = [
  { id: C1, projectId: P, startDate: '2026-10-20', endDate: '2026-10-30', closedAt: null },
  { id: C2, projectId: P, startDate: '2026-10-01', endDate: '2026-10-10', closedAt: null },
];
const task = (cycleId: string | null, projectId = P) =>
  ({ projectId, cycleId, assigneeIds: [], labelIds: [] }) as unknown as FilterTask;
const f = (operator: string, value?: string[]): Filter => ({
  op: 'and',
  rules: [{ field: 'cycle', operator: operator as 'in', value }],
});
const m = (t: FilterTask, fl: Filter, ctx: FilterCtx = { ...base, cycles }) =>
  matchFilter(t, fl, ctx);

describe('PLNRAPP-140: assignee = me учитывает назначенные мне комментарии и пункты', () => {
  it('forMe — задача с моим открытым пунктом/комментарием «моя»', () => {
    const t = { id: 't1', assigneeIds: [], labelIds: [] } as unknown as FilterTask;
    const rule = (operator: 'in' | 'notIn' | 'isEmpty', value?: string[]): Filter => ({
      op: 'and',
      rules: [{ field: 'assignee', operator, value }],
    });
    const forMe = new Set(['t1']);
    expect(m(t, rule('in', ['me']), base)).toBe(false);
    expect(m(t, rule('in', ['me']), { ...base, forMe })).toBe(true);
    expect(m(t, rule('in', ['u']), { ...base, forMe })).toBe(true);
    expect(m(t, rule('in', ['other']), { ...base, forMe })).toBe(false);
    expect(m(t, rule('notIn', ['me']), { ...base, forMe })).toBe(false);
    expect(m(t, rule('isEmpty'), { ...base, forMe })).toBe(true); // no task assignees
  });
});

describe('wk0: filter cycle', () => {
  it('wk0: in / notIn по id цикла', () => {
    expect(m(task(C1), f('in', [C1]))).toBe(true);
    expect(m(task(C2), f('in', [C1]))).toBe(false);
    expect(m(task(null), f('in', [C1]))).toBe(false);
    expect(m(task(C2), f('notIn', [C1]))).toBe(true);
    expect(m(task(null), f('notIn', [C1]))).toBe(true);
  });
  it('wk0: isEmpty / isNotEmpty', () => {
    expect(m(task(null), f('isEmpty'))).toBe(true);
    expect(m(task(C1), f('isEmpty'))).toBe(false);
    expect(m(task(C1), f('isNotEmpty'))).toBe(true);
  });
  it('wk0: current — текущий цикл проекта задачи', () => {
    expect(m(task(C1), f('in', ['current']))).toBe(true); // is today
    expect(m(task(C2), f('in', ['current']))).toBe(false); // has ended
    expect(m(task(C2), f('notIn', ['current']))).toBe(true);
    expect(m(task(C1, uuidv7()), f('in', ['current']))).toBe(false); // the task's project is different
    const closed = [{ ...cycles[0]!, closedAt: '2026-10-22T00:00:00.000Z' }];
    expect(m(task(C1), f('in', ['current']), { ...base, cycles: closed })).toBe(false);
  });
  it('wk0: без ctx.cycles правило с current пропускается', () => {
    expect(m(task(C2), f('in', ['current']), base)).toBe(true);
    expect(m(task(C2), f('in', [C1]), base)).toBe(false);
  });
});

describe('wk0: tasks.cycleId', () => {
  it('wk0: task.create → cycleId null', async () => {
    const tx = mem();
    const t = await seedTask(tx, await seedSpace(tx));
    expect((await tx.get('tasks', t))!.cycleId).toBeNull();
  });
  it('wk0: task.update не принимает cycleId', async () => {
    const tx = mem();
    const t = await seedTask(tx, await seedSpace(tx));
    await run(tx, 'task.update', { id: t, title: 'X', cycleId: id() });
    expect((await tx.get('tasks', t))!.cycleId).toBeNull();
  });
  it('wk0: смена projectId сбрасывает cycleId', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const t = await seedTask(tx, s);
    await tx.patch('tasks', t, { cycleId: id() });
    const p2 = id();
    await run(tx, 'project.create', {
      id: p2,
      spaceId: s.spaceId,
      name: 'Q',
      key: 'QQQ',
      rank: 'a1',
      statusIds: [id(), id(), id(), id(), id()],
    });
    await run(tx, 'task.update', { id: t, projectId: p2 });
    expect((await tx.get('tasks', t))!.cycleId).toBeNull();
  });
});
