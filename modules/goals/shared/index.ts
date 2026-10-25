import { z } from 'zod';
import {
  defineMutator,
  matchFilter,
  MutatorError,
  type Filter,
  type FilterCtx,
  type FilterTask,
  type SharedModuleManifest,
  type Tx,
} from '@planar/shared';

const ts = z.iso.datetime();
const date = z.iso.date();
const id = z.uuid();
const rank = z.string().min(1);

export const metricSchema = z
  .object({
    start: z.number().finite(),
    target: z.number().finite(),
    current: z.number().finite(),
    unit: z.string().max(20).nullable(),
  })
  .refine((m) => m.start !== m.target, 'start = target');
export const krFilterSchema = z.object({
  projectIds: z.array(id),
  filter: z.object({
    op: z.enum(['and', 'or']),
    rules: z.array(
      z.object({
        field: z.string(),
        operator: z.string(),
        value: z
          .union([z.array(z.string()), z.array(z.number()), z.string(), z.number()])
          .optional(),
      }),
    ),
  }),
});
export type Metric = z.output<typeof metricSchema>;
export type KrFilter = { projectIds: string[]; filter: Filter };

export const goalsMilestones = z.object({
  id,
  spaceId: id,
  projectId: id,
  name: z.string().min(1).max(200),
  date,
  description: z.string().max(2000).nullable(),
  createdAt: ts,
  updatedAt: ts,
});
export const goalsMilestoneTasks = z.object({
  id,
  spaceId: id,
  milestoneId: id,
  taskId: id,
  createdAt: ts,
});
export const goalsGoals = z.object({
  id,
  spaceId: id,
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable(),
  ownerId: id.nullable(),
  dueDate: date.nullable(),
  rank,
  archivedAt: ts.nullable(),
  createdBy: id,
  createdAt: ts,
  updatedAt: ts,
});
export const goalsKeyResults = z.object({
  id,
  spaceId: id,
  goalId: id,
  name: z.string().min(1).max(200),
  kind: z.enum(['number', 'tasks']),
  metric: metricSchema.nullable(),
  filter: krFilterSchema.nullable(),
  rank,
  createdAt: ts,
  updatedAt: ts,
});
export type Milestone = z.output<typeof goalsMilestones>;
export type MilestoneTask = z.output<typeof goalsMilestoneTasks>;
export type Goal = z.output<typeof goalsGoals>;
export type KeyResult = {
  id: string;
  spaceId: string;
  goalId: string;
  name: string;
  kind: 'number' | 'tasks';
  metric: Metric | null;
  filter: KrFilter | null;
  rank: string;
};

// ---- прогресс (чистые функции) ----

export type StatusCategory = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
const clamp = (x: number) => Math.min(1, Math.max(0, x));

/** Доля 0–1: `number` — шкала start→target; `tasks` — доля done среди неотменённых задач по фильтру. */
export function krProgress(
  kr: Pick<KeyResult, 'kind' | 'metric' | 'filter'>,
  tasks: FilterTask[],
  ctx: FilterCtx,
): number {
  if (kr.kind === 'number') {
    const m = kr.metric;
    return m ? clamp((m.current - m.start) / (m.target - m.start)) : 0;
  }
  if (!kr.filter) return 0;
  const { projectIds, filter } = kr.filter;
  const cat = new Map(ctx.statuses.map((s) => [s.id, s.category]));
  let done = 0;
  let total = 0;
  for (const t of tasks) {
    if (projectIds.length && !projectIds.includes(t.projectId)) continue;
    if (!matchFilter(t, filter, ctx)) continue;
    const c = cat.get(t.statusId);
    if (c === 'cancelled') continue;
    total++;
    if (c === 'done') done++;
  }
  return total ? done / total : 0;
}

/** Среднее по ключевым результатам; нет их — null. */
export const goalProgress = (progresses: number[]): number | null =>
  progresses.length ? progresses.reduce((a, b) => a + b, 0) / progresses.length : null;

export function milestoneProgress(tasks: { category: StatusCategory }[]): {
  counts: Record<StatusCategory, number>;
  done: number;
} {
  const counts: Record<StatusCategory, number> = {
    backlog: 0,
    todo: 0,
    in_progress: 0,
    done: 0,
    cancelled: 0,
  };
  for (const t of tasks) counts[t.category]++;
  const base = tasks.length - counts.cancelled;
  return { counts, done: base > 0 ? counts.done / base : 0 };
}

// ---- мутаторы ----

// Tx типизирован сущностями ядра; сущности модулей приводим (C-modules)
interface MTx {
  get<T>(e: string, id: string): Promise<T | undefined>;
  put(e: string, row: unknown): Promise<void>;
  patch(e: string, id: string, p: unknown): Promise<void>;
  del(e: string, id: string): Promise<void>;
  scan<T>(e: string, o: { index: string; eq: unknown }): Promise<T[]>;
}
const m = (tx: Tx) => tx as unknown as MTx;
const bad = (msg: string) => new MutatorError('invalid_args', msg);
const notFound = (what: string) => new MutatorError('not_found', what);

async function need<T>(tx: Tx, e: string, rowId: string): Promise<T> {
  const r = await m(tx).get<T>(e, rowId);
  if (!r) throw notFound(`${e} ${rowId}`);
  return r;
}
async function checkOwner(tx: Tx, spaceId: string, ownerId: string | null | undefined) {
  if (!ownerId) return;
  const ms = await tx.scan('spaceMembers', { index: 'spaceId', eq: spaceId });
  if (!ms.some((x) => x.userId === ownerId)) throw bad('ownerId не участник пространства');
}
/** Убрать задачу из вехи (строки по taskId). */
const unlink = async (tx: Tx, taskId: string) => {
  for (const r of await m(tx).scan<MilestoneTask>('goalsMilestoneTasks', {
    index: 'taskId',
    eq: taskId,
  }))
    await m(tx).del('goalsMilestoneTasks', r.id);
};

const nullable = <T extends z.ZodType>(s: T) => s.nullable().optional();
/** patch без `id` и ключей undefined */
const clean = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([k, v]) => k !== 'id' && v !== undefined));

export const mutators = [
  defineMutator({
    name: 'goals.milestone.create',
    args: z.object({
      id,
      projectId: id,
      name: goalsMilestones.shape.name,
      date,
      description: goalsMilestones.shape.description.optional(),
    }),
    async run(tx, a, ctx) {
      const p = await tx.get('projects', a.projectId);
      if (!p) throw notFound(`project ${a.projectId}`);
      await m(tx).put('goalsMilestones', {
        id: a.id,
        spaceId: p.spaceId,
        projectId: a.projectId,
        name: a.name,
        date: a.date,
        description: a.description ?? null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'goals.milestone.update',
    args: z.object({
      id,
      name: goalsMilestones.shape.name.optional(),
      date: date.optional(),
      description: nullable(goalsMilestones.shape.description.unwrap()),
    }),
    async run(tx, a, ctx) {
      await need(tx, 'goalsMilestones', a.id);
      await m(tx).patch('goalsMilestones', a.id, { ...clean(a), updatedAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'goals.milestone.delete',
    args: z.object({ id }),
    async run(tx, a) {
      for (const r of await m(tx).scan<MilestoneTask>('goalsMilestoneTasks', {
        index: 'milestoneId',
        eq: a.id,
      }))
        await m(tx).del('goalsMilestoneTasks', r.id);
      await m(tx).del('goalsMilestones', a.id);
    },
  }),
  defineMutator({
    name: 'goals.milestone.setTask',
    args: z.object({ id, taskId: id, milestoneId: id.nullable() }),
    async run(tx, a, ctx) {
      const task = await tx.get('tasks', a.taskId);
      if (!task) throw notFound(`task ${a.taskId}`);
      if (a.milestoneId === null) return unlink(tx, a.taskId);
      const ms = await need<Milestone>(tx, 'goalsMilestones', a.milestoneId);
      if (ms.projectId !== task.projectId) throw bad('задача не из проекта вехи');
      const [old] = await m(tx).scan<MilestoneTask>('goalsMilestoneTasks', {
        index: 'taskId',
        eq: a.taskId,
      });
      if (old) return m(tx).patch('goalsMilestoneTasks', old.id, { milestoneId: ms.id });
      if (await m(tx).get('goalsMilestoneTasks', a.id)) throw bad('id занят');
      await m(tx).put('goalsMilestoneTasks', {
        id: a.id,
        spaceId: ms.spaceId,
        milestoneId: ms.id,
        taskId: a.taskId,
        createdAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'goals.goal.create',
    args: z.object({
      id,
      spaceId: id,
      name: goalsGoals.shape.name,
      rank,
      description: goalsGoals.shape.description.optional(),
      ownerId: id.nullable().optional(),
      dueDate: date.nullable().optional(),
    }),
    async run(tx, a, ctx) {
      await checkOwner(tx, a.spaceId, a.ownerId);
      await m(tx).put('goalsGoals', {
        id: a.id,
        spaceId: a.spaceId,
        name: a.name,
        description: a.description ?? null,
        ownerId: a.ownerId ?? null,
        dueDate: a.dueDate ?? null,
        rank: a.rank,
        archivedAt: null,
        createdBy: ctx.userId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'goals.goal.update',
    args: z.object({
      id,
      name: goalsGoals.shape.name.optional(),
      description: nullable(z.string().max(5000)),
      ownerId: nullable(id),
      dueDate: nullable(date),
      rank: rank.optional(),
      archivedAt: nullable(ts),
    }),
    async run(tx, a, ctx) {
      const g = await need<Goal>(tx, 'goalsGoals', a.id);
      await checkOwner(tx, g.spaceId, a.ownerId);
      await m(tx).patch('goalsGoals', a.id, { ...clean(a), updatedAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'goals.goal.delete',
    args: z.object({ id }),
    async run(tx, a) {
      for (const k of await m(tx).scan<KeyResult>('goalsKeyResults', {
        index: 'goalId',
        eq: a.id,
      }))
        await m(tx).del('goalsKeyResults', k.id);
      await m(tx).del('goalsGoals', a.id);
    },
  }),
  defineMutator({
    name: 'goals.kr.create',
    args: z.object({
      id,
      goalId: id,
      name: goalsKeyResults.shape.name,
      kind: z.enum(['number', 'tasks']),
      rank,
      metric: metricSchema.nullable().optional(),
      filter: krFilterSchema.nullable().optional(),
    }),
    async run(tx, a, ctx) {
      const g = await need<Goal>(tx, 'goalsGoals', a.goalId);
      if (a.kind === 'number' ? !a.metric || a.filter : !a.filter || a.metric)
        throw bad(a.kind === 'number' ? 'number: нужен metric' : 'tasks: нужен filter');
      await m(tx).put('goalsKeyResults', {
        id: a.id,
        spaceId: g.spaceId,
        goalId: g.id,
        name: a.name,
        kind: a.kind,
        metric: a.metric ?? null,
        filter: a.filter ?? null,
        rank: a.rank,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'goals.kr.update',
    args: z.object({
      id,
      name: goalsKeyResults.shape.name.optional(),
      metric: metricSchema.optional(),
      filter: krFilterSchema.optional(),
      rank: rank.optional(),
    }),
    async run(tx, a, ctx) {
      const k = await need<KeyResult>(tx, 'goalsKeyResults', a.id);
      if ((a.metric && k.kind !== 'number') || (a.filter && k.kind !== 'tasks'))
        throw bad(`поле не для kind ${k.kind}`);
      await m(tx).patch('goalsKeyResults', a.id, { ...clean(a), updatedAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'goals.kr.delete',
    args: z.object({ id }),
    async run(tx, a) {
      await m(tx).del('goalsKeyResults', a.id);
    },
  }),
];

export const shared: SharedModuleManifest = {
  id: 'goals',
  mutators,
  entities: {
    goalsMilestones: {
      schema: goalsMilestones,
      meta: { scope: 'space', write: 'member', bootstrap: true, indexes: ['spaceId', 'projectId'] },
    },
    goalsMilestoneTasks: {
      schema: goalsMilestoneTasks,
      meta: {
        scope: 'space',
        write: 'member',
        bootstrap: true,
        indexes: ['milestoneId', 'taskId'],
      },
    },
    goalsGoals: {
      schema: goalsGoals,
      meta: { scope: 'space', write: 'member', bootstrap: true, indexes: ['spaceId'] },
    },
    goalsKeyResults: {
      schema: goalsKeyResults,
      meta: { scope: 'space', write: 'member', bootstrap: true, indexes: ['goalId'] },
    },
  },
};
