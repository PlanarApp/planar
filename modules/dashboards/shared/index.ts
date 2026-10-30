import { z } from 'zod';
import {
  defineMutator,
  MutatorError,
  type EntityName,
  type SharedModuleManifest,
  type Tx,
} from '@planar/shared';

const ts = z.iso.datetime();
const id = z.uuid();
const bad = (m: string) => new MutatorError('invalid_args', m);

export const dashboardsBoards = z.object({
  id,
  spaceId: id,
  userId: id.nullable(),
  name: z.string().min(1).max(100),
  rank: z.string().min(1),
  createdBy: id,
  createdAt: ts,
  updatedAt: ts,
});

export const KINDS = ['number', 'bars', 'line', 'list'] as const;
export const dashboardsWidgets = z.object({
  id,
  dashboardId: id,
  spaceId: id,
  userId: id.nullable(),
  kind: z.enum(KINDS),
  title: z.string().max(100).nullable(),
  config: z.record(z.string(), z.unknown()),
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(12),
  createdAt: ts,
  updatedAt: ts,
});
export type Board = z.output<typeof dashboardsBoards>;
export type Widget = z.output<typeof dashboardsWidgets>;

// F-filter v2 (packages/shared/src/filter.ts): matchFilter checks the rule shape, here only the skeleton
const filter = z.object({
  op: z.enum(['and', 'or']),
  rules: z.array(
    z.object({
      field: z.string().min(1),
      operator: z.string().min(1),
      value: z.union([z.string(), z.number(), z.array(z.string()), z.array(z.number())]).optional(),
    }),
  ),
});
const GROUP = z.union([
  z.enum(['status', 'priority', 'assignee', 'label', 'project']),
  z.string().regex(/^field:.+/),
]);
export const configs = {
  number: z.object({ filter }),
  bars: z.object({ filter, groupBy: GROUP }),
  line: z.object({
    filter,
    series: z.enum(['created', 'completed']),
    weeks: z.number().int().min(4).max(52),
  }),
  list: z.object({
    filter,
    sort: z.enum(['updatedAt', 'dueDate', 'priority']),
    limit: z.number().int().min(1).max(50),
  }),
};
export type WidgetKind = (typeof KINDS)[number];

function checkConfig(kind: WidgetKind, config: unknown): Record<string, unknown> {
  const r = configs[kind].safeParse(config);
  if (!r.success) throw bad(`config (${kind}): ${r.error.issues[0]?.message}`);
  return r.data;
}
function checkBox(b: { x: number; w: number }) {
  if (b.x + b.w > 12) throw bad('x + w > 12');
}

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

/** Dashboard: none → not_found; someone else's personal one → forbidden (spaces are checked by the write role). */
async function board(tx: Tx, bid: string, userId: string) {
  const b = (await mtx(tx).get(E('dashboardsBoards'), bid)) as Board | undefined;
  if (!b) throw new MutatorError('not_found', `dashboardsBoards ${bid}`);
  if (b.userId && b.userId !== userId) throw new MutatorError('forbidden', 'чужой дашборд');
  return b;
}
async function widget(tx: Tx, wid: string, userId: string) {
  const w = (await mtx(tx).get(E('dashboardsWidgets'), wid)) as Widget | undefined;
  if (!w) throw new MutatorError('not_found', `dashboardsWidgets ${wid}`);
  if (w.userId && w.userId !== userId) throw new MutatorError('forbidden', 'чужой виджет');
  return w;
}

const name = z.string().min(1).max(100);
const rank = z.string().min(1);
const title = z.string().max(100).nullable().optional();
const box = {
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(12),
};

export const mutators = [
  defineMutator({
    name: 'dashboards.create',
    args: z.object({ id, spaceId: id, name, rank, personal: z.boolean().optional() }),
    async run(tx, a, ctx) {
      if (await mtx(tx).get(E('dashboardsBoards'), a.id))
        throw new MutatorError('conflict', 'дашборд уже есть');
      await mtx(tx).put(E('dashboardsBoards'), {
        id: a.id,
        spaceId: a.spaceId,
        userId: a.personal ? ctx.userId : null,
        name: a.name,
        rank: a.rank,
        createdBy: ctx.userId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'dashboards.update',
    args: z.object({ id, name: name.optional(), rank: rank.optional() }),
    async run(tx, a, ctx) {
      await board(tx, a.id, ctx.userId);
      const p: Record<string, unknown> = { ...a };
      delete p.id;
      await mtx(tx).patch(E('dashboardsBoards'), a.id, { ...p, updatedAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'dashboards.delete',
    args: z.object({ id }),
    async run(tx, a, ctx) {
      await board(tx, a.id, ctx.userId);
      for (const w of (await mtx(tx).scan(E('dashboardsWidgets'), {
        index: 'dashboardId',
        eq: a.id,
      })) as Widget[])
        await mtx(tx).del(E('dashboardsWidgets'), w.id);
      await mtx(tx).del(E('dashboardsBoards'), a.id);
    },
  }),
  defineMutator({
    name: 'dashboards.widget.add',
    args: z.object({
      id,
      dashboardId: id,
      kind: z.enum(KINDS),
      config: z.record(z.string(), z.unknown()),
      ...box,
      title,
    }),
    async run(tx, a, ctx) {
      const b = await board(tx, a.dashboardId, ctx.userId);
      if (await mtx(tx).get(E('dashboardsWidgets'), a.id))
        throw new MutatorError('conflict', 'виджет уже есть');
      checkBox(a);
      await mtx(tx).put(E('dashboardsWidgets'), {
        id: a.id,
        dashboardId: b.id,
        spaceId: b.spaceId,
        userId: b.userId,
        kind: a.kind,
        title: a.title ?? null,
        config: checkConfig(a.kind, a.config),
        x: a.x,
        y: a.y,
        w: a.w,
        h: a.h,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'dashboards.widget.update',
    args: z.object({
      id,
      title,
      config: z.record(z.string(), z.unknown()).optional(),
      x: box.x.optional(),
      y: box.y.optional(),
      w: box.w.optional(),
      h: box.h.optional(),
    }),
    async run(tx, a, ctx) {
      const w = await widget(tx, a.id, ctx.userId);
      checkBox({ x: a.x ?? w.x, w: a.w ?? w.w });
      const p: Record<string, unknown> = { ...a };
      delete p.id;
      if (a.config) p.config = checkConfig(w.kind, a.config);
      await mtx(tx).patch(E('dashboardsWidgets'), a.id, { ...p, updatedAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'dashboards.widget.remove',
    args: z.object({ id }),
    async run(tx, a, ctx) {
      await widget(tx, a.id, ctx.userId);
      await mtx(tx).del(E('dashboardsWidgets'), a.id);
    },
  }),
];

export const shared: SharedModuleManifest = {
  id: 'dashboards',
  mutators,
  entities: {
    dashboardsBoards: {
      schema: dashboardsBoards,
      meta: {
        scope: 'space|user',
        write: 'member|self',
        bootstrap: true,
        indexes: ['spaceId', 'userId'],
      },
    },
    dashboardsWidgets: {
      schema: dashboardsWidgets,
      meta: {
        scope: 'space|user',
        write: 'member|self',
        bootstrap: true,
        indexes: ['dashboardId'],
      },
    },
  },
};
