import { z } from 'zod';
import {
  MutatorError,
  defineMutator,
  type Row,
  type SharedModuleManifest,
  type Tx,
} from '@planar/shared';

const ts = z.iso.datetime();
const date = z.iso.date();

export const sprintsSettings = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  projectId: z.uuid(),
  enabled: z.boolean(),
  lengthDays: z.number().int().min(1).max(60),
  timezone: z.string().min(1),
  autoCreate: z.boolean(),
  createdAt: ts,
  updatedAt: ts,
});
export const sprintsCycles = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  projectId: z.uuid(),
  number: z.number().int(),
  name: z.string().max(100).nullable(),
  startDate: date,
  endDate: date,
  closedAt: ts.nullable(),
  createdAt: ts,
  updatedAt: ts,
});
export type Settings = z.infer<typeof sprintsSettings>;
export type Cycle = z.infer<typeof sprintsCycles>;

// Tx is typed with core entities; module entities are cast (C-modules)
interface ModTx {
  get<T>(e: string, id: string): Promise<T | undefined>;
  put(e: string, row: unknown): Promise<void>;
  patch(e: string, id: string, p: unknown): Promise<void>;
  del(e: string, id: string): Promise<void>;
  scan<T>(e: string, o: { index: string; eq: unknown }): Promise<T[]>;
}
const m = (tx: Tx) => tx as unknown as ModTx;
const bad = (msg: string) => new MutatorError('invalid_args', msg);

export const DEFAULTS = { lengthDays: 14, timezone: 'UTC', autoCreate: true };

export function addDays(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** Today's date YYYY-MM-DD in the time zone. */
export const todayIn = (timeZone: string, now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);

const validTz = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
};

const cyclesOf = (tx: Tx, projectId: string) =>
  m(tx).scan<Cycle>('sprintsCycles', { index: 'projectId', eq: projectId });
const settingsOf = async (tx: Tx, projectId: string) => ({
  ...DEFAULTS,
  ...(await m(tx).get<Settings>('sprintsSettings', projectId)),
});

async function needCycle(tx: Tx, id: string): Promise<Cycle> {
  const c = await m(tx).get<Cycle>('sprintsCycles', id);
  if (!c) throw new MutatorError('not_found', `sprintsCycles ${id}`);
  return c;
}

/** The dates are valid and do not overlap other project cycles (except self). */
async function checkDates(tx: Tx, projectId: string, start: string, end: string, self?: string) {
  if (end < start) throw bad('endDate < startDate');
  for (const c of await cyclesOf(tx, projectId))
    if (c.id !== self && c.startDate <= end && start <= c.endDate)
      throw new MutatorError('conflict', 'циклы пересекаются по датам');
}

async function insertCycle(
  tx: Tx,
  ctx: { now: string },
  a: {
    id: string;
    projectId: string;
    spaceId: string;
    start: string;
    end: string;
    name?: string | null;
  },
) {
  await checkDates(tx, a.projectId, a.start, a.end);
  const number = Math.max(0, ...(await cyclesOf(tx, a.projectId)).map((c) => c.number)) + 1;
  const row: Cycle = {
    id: a.id,
    spaceId: a.spaceId,
    projectId: a.projectId,
    number,
    name: a.name ?? null,
    startDate: a.start,
    endDate: a.end,
    closedAt: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  await m(tx).put('sprintsCycles', row);
}

const uuid = z.uuid();

export const configure = defineMutator({
  name: 'sprints.configure',
  args: z.object({
    projectId: uuid,
    enabled: z.boolean().optional(),
    lengthDays: z.number().int().min(1).max(60).optional(),
    timezone: z.string().min(1).optional(),
    autoCreate: z.boolean().optional(),
  }),
  async run(tx, a, ctx) {
    if (a.timezone !== undefined && !validTz(a.timezone)) throw bad(`timezone: ${a.timezone}`);
    const project = await tx.get('projects', a.projectId);
    if (!project) throw new MutatorError('not_found', `project ${a.projectId}`);
    const old = await m(tx).get<Settings>('sprintsSettings', a.projectId);
    const pick = <K extends 'enabled' | 'lengthDays' | 'timezone' | 'autoCreate'>(k: K) =>
      a[k] ?? old?.[k] ?? ({ enabled: true, ...DEFAULTS } as Record<string, unknown>)[k];
    await m(tx).put('sprintsSettings', {
      id: a.projectId,
      spaceId: project.spaceId,
      projectId: a.projectId,
      enabled: pick('enabled'),
      lengthDays: pick('lengthDays'),
      timezone: pick('timezone'),
      autoCreate: pick('autoCreate'),
      createdAt: old?.createdAt ?? ctx.now,
      updatedAt: ctx.now,
    });
  },
});

export const create = defineMutator({
  name: 'sprints.create',
  args: z.object({
    id: uuid,
    projectId: uuid,
    startDate: date,
    endDate: date.optional(),
    name: z.string().max(100).optional(),
  }),
  async run(tx, a, ctx) {
    const project = await tx.get('projects', a.projectId);
    if (!project) throw new MutatorError('not_found', `project ${a.projectId}`);
    const { lengthDays } = await settingsOf(tx, a.projectId);
    await insertCycle(tx, ctx, {
      id: a.id,
      projectId: a.projectId,
      spaceId: project.spaceId,
      start: a.startDate,
      end: a.endDate ?? addDays(a.startDate, lengthDays - 1),
      name: a.name,
    });
  },
});

export const update = defineMutator({
  name: 'sprints.update',
  args: z.object({
    id: uuid,
    name: z.string().max(100).nullable().optional(),
    startDate: date.optional(),
    endDate: date.optional(),
  }),
  async run(tx, a, ctx) {
    const c = await needCycle(tx, a.id);
    if (c.closedAt) throw new MutatorError('conflict', 'цикл закрыт');
    const start = a.startDate ?? c.startDate;
    const end = a.endDate ?? c.endDate;
    await checkDates(tx, c.projectId, start, end, c.id);
    await m(tx).patch('sprintsCycles', c.id, {
      name: a.name === undefined ? c.name : a.name,
      startDate: start,
      endDate: end,
      updatedAt: ctx.now,
    });
  },
});

const setCycle = (tx: Tx, taskId: string, cycleId: string | null, now: string) =>
  tx.patch('tasks', taskId, { cycleId, updatedAt: now } as Partial<Row<'tasks'>>);

export const del = defineMutator({
  name: 'sprints.delete',
  args: z.object({ id: uuid }),
  async run(tx, a, ctx) {
    for (const t of await tx.scan('tasks', { index: 'cycleId', eq: a.id }))
      await setCycle(tx, t.id, null, ctx.now);
    await m(tx).del('sprintsCycles', a.id);
  },
});

export const setTask = defineMutator({
  name: 'sprints.setTask',
  args: z.object({ taskId: uuid, cycleId: uuid.nullable() }),
  async run(tx, a, ctx) {
    const task = await tx.get('tasks', a.taskId);
    if (!task) throw new MutatorError('not_found', `task ${a.taskId}`);
    if (a.cycleId) {
      const c = await m(tx).get<Cycle>('sprintsCycles', a.cycleId);
      if (!c || c.projectId !== task.projectId || c.closedAt)
        throw bad('цикл чужого проекта или закрыт');
    }
    await setCycle(tx, task.id, a.cycleId, ctx.now);
  },
});

export const close = defineMutator({
  name: 'sprints.close',
  args: z.object({ id: uuid, nextId: uuid }),
  async run(tx, a, ctx) {
    const c = await needCycle(tx, a.id);
    if (c.closedAt) return;
    const s = await settingsOf(tx, c.projectId);
    const all = await cyclesOf(tx, c.projectId);
    let next: string | null =
      all
        .filter((x) => !x.closedAt && x.startDate > c.endDate)
        .sort((x, y) => (x.startDate < y.startDate ? -1 : 1))[0]?.id ?? null;
    if (!next && s.autoCreate) {
      await insertCycle(tx, ctx, {
        id: a.nextId,
        projectId: c.projectId,
        spaceId: c.spaceId,
        start: addDays(c.endDate, 1),
        end: addDays(c.endDate, s.lengthDays),
      });
      next = a.nextId;
    }
    const category = new Map<string, string>();
    for (const t of await tx.scan('tasks', { index: 'cycleId', eq: c.id })) {
      if (!category.has(t.statusId))
        category.set(t.statusId, (await tx.get('statuses', t.statusId))?.category ?? '');
      const cat = category.get(t.statusId);
      if (cat !== 'done' && cat !== 'cancelled') await setCycle(tx, t.id, next, ctx.now);
    }
    await m(tx).patch('sprintsCycles', c.id, { closedAt: ctx.now, updatedAt: ctx.now });
  },
});

export const shared: SharedModuleManifest = {
  id: 'sprints',
  mutators: [configure, create, update, del, setTask, close],
  entities: {
    sprintsSettings: {
      schema: sprintsSettings,
      meta: { scope: 'space', write: 'member', bootstrap: true, indexes: ['projectId'] },
    },
    sprintsCycles: {
      schema: sprintsCycles,
      meta: { scope: 'space', write: 'member', bootstrap: true, indexes: ['spaceId', 'projectId'] },
    },
  },
};
