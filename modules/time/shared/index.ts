import { z } from 'zod';
import {
  defineMutator,
  MutatorError,
  type EntityName,
  type SharedModuleManifest,
  type Tx,
} from '@planar/shared';

const ts = z.iso.datetime();
const bad = (m: string) => new MutatorError('invalid_args', m);

export const timeEntries = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  taskId: z.uuid(),
  userId: z.uuid(),
  startedAt: ts,
  endedAt: ts.nullable(),
  durationSec: z.number().int().min(0).nullable(),
  note: z.string().max(1000).nullable(),
  source: z.enum(['timer', 'manual']),
  billable: z.boolean(),
  createdAt: ts,
  updatedAt: ts,
});
export const timeEstimates = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  taskId: z.uuid(),
  minutes: z.number().int().min(1).max(100000),
  updatedBy: z.uuid(),
  updatedAt: ts,
});
export type TimeEntry = z.output<typeof timeEntries>;
export type TimeEstimate = z.output<typeof timeEstimates>;

// Tx is typed with core entities; module entities are cast (C-modules)
interface MTx {
  get(e: string, id: string): Promise<unknown>;
  put(e: string, row: unknown): Promise<void>;
  patch(e: string, id: string, p: unknown): Promise<void>;
  del(e: string, id: string): Promise<void>;
  scan(e: string, o: { index: string; eq: unknown }): Promise<unknown[]>;
}
const mtx = (tx: Tx) => tx as unknown as MTx;
const E = (n: string) => n as EntityName;
const getEntry = async (tx: Tx, id: string) =>
  (await mtx(tx).get(E('timeEntries'), id)) as TimeEntry | undefined;

/** Own entry: none → not_found, someone else's → forbidden. */
async function own(tx: Tx, id: string, userId: string) {
  const e = await getEntry(tx, id);
  if (!e) throw new MutatorError('not_found', `timeEntries ${id}`);
  if (e.userId !== userId) throw new MutatorError('forbidden', 'чужая запись времени');
  return e;
}

const sec = (from: string, to: string) =>
  Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 1000));
const plus = (iso: string, s: number) => new Date(Date.parse(iso) + s * 1000).toISOString();

async function taskOf(tx: Tx, taskId: string) {
  const t = await tx.get('tasks', taskId);
  if (!t) throw new MutatorError('not_found', `tasks ${taskId}`);
  return t;
}

async function stopRunning(tx: Tx, userId: string, now: string) {
  for (const e of (await mtx(tx).scan(E('timeEntries'), {
    index: 'userId',
    eq: userId,
  })) as TimeEntry[])
    if (!e.endedAt)
      await mtx(tx).patch(E('timeEntries'), e.id, {
        endedAt: now,
        durationSec: sec(e.startedAt, now),
        updatedAt: now,
      });
}

async function create(tx: Tx, row: Omit<TimeEntry, 'createdAt' | 'updatedAt'>, now: string) {
  if (await getEntry(tx, row.id)) throw new MutatorError('conflict', 'запись уже есть');
  await mtx(tx).put(E('timeEntries'), { ...row, createdAt: now, updatedAt: now });
}

const id = z.uuid();
const note = z.string().max(1000).nullable().optional();
const billable = z.boolean().optional();

export const mutators = [
  defineMutator({
    name: 'time.start',
    args: z.object({ id, taskId: id }),
    async run(tx, a, ctx) {
      const task = await taskOf(tx, a.taskId);
      await stopRunning(tx, ctx.userId, ctx.now);
      await create(
        tx,
        {
          id: a.id,
          spaceId: task.spaceId,
          taskId: a.taskId,
          userId: ctx.userId,
          startedAt: ctx.now,
          endedAt: null,
          durationSec: null,
          note: null,
          source: 'timer',
          billable: false,
        },
        ctx.now,
      );
    },
  }),
  defineMutator({
    name: 'time.stop',
    args: z.object({ id }),
    async run(tx, a, ctx) {
      const e = await own(tx, a.id, ctx.userId);
      if (e.endedAt) return;
      await mtx(tx).patch(E('timeEntries'), e.id, {
        endedAt: ctx.now,
        durationSec: sec(e.startedAt, ctx.now),
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'time.log',
    args: z.object({
      id,
      taskId: id,
      startedAt: ts,
      durationSec: z.number().int().min(1).max(86400),
      note,
      billable,
    }),
    async run(tx, a, ctx) {
      const task = await taskOf(tx, a.taskId);
      await create(
        tx,
        {
          id: a.id,
          spaceId: task.spaceId,
          taskId: a.taskId,
          userId: ctx.userId,
          startedAt: a.startedAt,
          endedAt: plus(a.startedAt, a.durationSec),
          durationSec: a.durationSec,
          note: a.note ?? null,
          source: 'manual',
          billable: a.billable ?? false,
        },
        ctx.now,
      );
    },
  }),
  defineMutator({
    name: 'time.update',
    args: z.object({
      id,
      startedAt: ts.optional(),
      endedAt: ts.optional(),
      durationSec: z.number().int().min(0).max(86400).optional(),
      note,
      billable,
    }),
    async run(tx, a, ctx) {
      const e = await own(tx, a.id, ctx.userId);
      const patch: Partial<TimeEntry> = { updatedAt: ctx.now };
      if (a.note !== undefined) patch.note = a.note;
      if (a.billable !== undefined) patch.billable = a.billable;
      const startedAt = a.startedAt ?? e.startedAt;
      if (a.startedAt) patch.startedAt = a.startedAt;
      if (!e.endedAt) {
        if (a.endedAt !== undefined || a.durationSec !== undefined)
          throw bad('у идущей записи правятся только startedAt и note');
      } else if (a.durationSec !== undefined) {
        patch.durationSec = a.durationSec;
        patch.endedAt = plus(startedAt, a.durationSec);
      } else if (a.startedAt || a.endedAt) {
        const endedAt = a.endedAt ?? e.endedAt;
        if (Date.parse(endedAt) < Date.parse(startedAt)) throw bad('endedAt раньше startedAt');
        patch.endedAt = endedAt;
        patch.durationSec = sec(startedAt, endedAt);
      }
      await mtx(tx).patch(E('timeEntries'), e.id, patch);
    },
  }),
  defineMutator({
    name: 'time.delete',
    args: z.object({ id }),
    async run(tx, a, ctx) {
      await own(tx, a.id, ctx.userId);
      await mtx(tx).del(E('timeEntries'), a.id);
    },
  }),
  defineMutator({
    name: 'time.setEstimate',
    args: z.object({ taskId: id, minutes: z.number().int().min(1).max(100000).nullable() }),
    async run(tx, a, ctx) {
      const task = await taskOf(tx, a.taskId);
      if (a.minutes === null) return mtx(tx).del(E('timeEstimates'), a.taskId);
      await mtx(tx).put(E('timeEstimates'), {
        id: a.taskId,
        spaceId: task.spaceId,
        taskId: a.taskId,
        minutes: a.minutes,
        updatedBy: ctx.userId,
        updatedAt: ctx.now,
      });
    },
  }),
];

export const shared: SharedModuleManifest = {
  id: 'time',
  mutators,
  entities: {
    timeEntries: {
      schema: timeEntries,
      meta: {
        scope: 'space',
        write: 'member',
        bootstrap: true,
        indexes: ['spaceId', 'taskId', 'userId'],
      },
    },
    timeEstimates: {
      schema: timeEstimates,
      meta: { scope: 'space', write: 'member', bootstrap: true, indexes: ['taskId'] },
    },
  },
};
