import { z } from 'zod';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import {
  FIELD_TYPES,
  MutatorError,
  defineMutator,
  domainMutators,
  entitySchemas,
  fieldValueSchema,
  type EntityName,
  type FieldType,
  type MutatorCtx,
  type SharedModuleManifest,
  type Tx,
} from '@planar/shared';

const id = z.uuid();
const ts = z.iso.datetime();
const docOrNull = entitySchemas.projects.shape.description;
const MAX_JSON = 256 * 1024;
const norm = (s: string) => s.trim().toLowerCase();

// --- data format (P4-templates v1)
const fieldType = z.enum(FIELD_TYPES);
const days = z.number().int().min(0).max(3650).nullable();
const taskBase = z.object({
  title: z.string().min(1).max(500),
  description: docOrNull,
  priority: z.number().int().min(0).max(4),
  dueInDays: days,
  startInDays: days,
  fields: z
    .array(z.object({ name: z.string().min(1).max(100), type: fieldType, value: z.unknown() }))
    .max(50),
  labels: z.array(z.string().min(1).max(100)).max(50),
  assigneeIds: z.array(id).max(20),
  checklist: z.array(z.string().min(1).max(500)).max(100),
});
export const taskTemplateSchema = taskBase.extend({ subtasks: z.array(taskBase).max(50) });
const color = z.string().min(1).max(50);
export const projectTemplateSchema = z
  .object({
    project: z.object({
      description: docOrNull,
      color: color.nullable(),
      icon: z.string().max(100).nullable(),
    }),
    statuses: z
      .array(
        z.object({
          name: z.string().min(1).max(100),
          category: z.enum(['backlog', 'todo', 'in_progress', 'done', 'cancelled']),
          color,
        }),
      )
      .max(30),
    labels: z.array(z.object({ name: z.string().min(1).max(100), color })).max(100),
    fields: z
      .array(
        z.object({
          name: z.string().min(1).max(100),
          type: fieldType,
          options: z.record(z.string(), z.unknown()),
        }),
      )
      .max(50),
    tasks: z.array(taskTemplateSchema.extend({ status: z.string().min(1).max(100) })).max(500),
  })
  .refine(
    (d) => d.tasks.every((t) => d.statuses.some((s) => norm(s.name) === norm(t.status))),
    'status задачи не из statuses',
  );

export type TemplateTask = z.output<typeof taskBase>;
export type TaskTemplate = z.output<typeof taskTemplateSchema>;
export type ProjectTemplate = z.output<typeof projectTemplateSchema>;
export type TemplateKind = 'task' | 'project';

const dataSchema = (kind: TemplateKind): z.ZodType => {
  const s: z.ZodType = kind === 'task' ? taskTemplateSchema : projectTemplateSchema;
  return s.refine((d) => JSON.stringify(d).length <= MAX_JSON, 'data > 256 КБ');
};

export const templatesTemplates = z.object({
  id,
  spaceId: id,
  kind: z.enum(['task', 'project']),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  data: z.json(),
  createdBy: id,
  createdAt: ts,
  updatedAt: ts,
});
export type TemplateRow = z.output<typeof templatesTemplates>;

// --- id plan: one function for the client and the server
const nodeCount = (t: TemplateTask) =>
  1 + t.assigneeIds.length + t.labels.length + t.checklist.length;
const taskCount = (t: TaskTemplate) =>
  nodeCount(t) + t.subtasks.reduce((n, s) => n + nodeCount(s), 0);

/**
 * Consumption of `ids` in order: a task — the task's id, an id for each assignee, label, checklist item
 * (in template order), then the same for subtasks; a project — statuses, labels, fields, then tasks.
 * Skipped ids (no label, not a member) are consumed too.
 */
export function templateIdPlan(kind: TemplateKind, data: unknown): { count: number } {
  if (kind === 'task') return { count: taskCount(taskTemplateSchema.parse(data)) };
  const p = projectTemplateSchema.parse(data);
  return {
    count:
      p.statuses.length +
      p.labels.length +
      p.fields.length +
      p.tasks.reduce((n, t) => n + taskCount(t), 0),
  };
}

// --- mutators
// Tx is typed with core entities; module entities are cast (C-modules)
interface MTx {
  get(e: string, id: string): Promise<unknown>;
  put(e: string, row: unknown): Promise<void>;
  patch(e: string, id: string, p: unknown): Promise<void>;
  del(e: string, id: string): Promise<void>;
}
const mtx = (tx: Tx) => tx as unknown as MTx;
const E = (n: string) => n as EntityName;
const bad = (m: string) => new MutatorError('invalid_args', m);

const core = (name: string) => {
  const m = domainMutators.find((x) => x.name === name);
  if (!m) throw new Error(`нет мутатора ядра ${name}`);
  return (tx: Tx, args: unknown, ctx: MutatorCtx) => m.run(tx, m.args.parse(args), ctx);
};
const taskCreate = core('task.create');
const taskSetField = core('task.setField');
const checklistAdd = core('checklist.add');
const projectCreate = core('project.create');
const statusCreate = core('status.create');
const labelCreate = core('label.create');
const fieldCreate = core('field.create');

const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

type FieldDef = { id: string; type: FieldType; options: Record<string, unknown> };
interface Env {
  spaceId: string;
  projectId: string;
  today: string;
  members: Set<string>;
  labels: Map<string, string>;
  fields: Map<string, FieldDef>;
}
const fieldKey = (name: string, type: string) => `${norm(name)}\0${type}`;

async function loadMembers(tx: Tx, spaceId: string) {
  const ms = await tx.scan('spaceMembers', { index: 'spaceId', eq: spaceId });
  return new Set(ms.map((m) => m.userId));
}

function idSource(ids: string[], count: number) {
  if (ids.length < count) throw bad(`ids: нужно ${count}, передано ${ids.length}`);
  let i = 0;
  return () => ids[i++]!;
}

/** A template task (and its subtasks, if sub is not empty) via the core mutators. */
async function makeTask(
  tx: Tx,
  ctx: MutatorCtx,
  env: Env,
  next: () => string,
  node: TemplateTask,
  o: { statusId: string; rank: string; parentId?: string | null },
): Promise<string> {
  const taskId = next();
  const assignees = node.assigneeIds.map((userId) => ({ id: next(), userId }));
  const labels = node.labels.map((l) => ({ id: next(), labelId: env.labels.get(norm(l)) }));
  const items = node.checklist.map((text) => ({ id: next(), text }));
  const seenA = new Set<string>();
  const seenL = new Set<string>();
  await taskCreate(
    tx,
    {
      id: taskId,
      projectId: env.projectId,
      statusId: o.statusId,
      title: node.title,
      rank: o.rank,
      parentId: o.parentId,
      description: node.description,
      priority: node.priority,
      dueDate: node.dueInDays === null ? null : addDays(env.today, node.dueInDays),
      startDate: node.startInDays === null ? null : addDays(env.today, node.startInDays),
      assignees: assignees.filter(
        (a) => env.members.has(a.userId) && !seenA.has(a.userId) && seenA.add(a.userId),
      ),
      labels: labels.filter((l) => l.labelId && !seenL.has(l.labelId) && seenL.add(l.labelId)),
    },
    ctx,
  );
  for (const f of node.fields) {
    const def = env.fields.get(fieldKey(f.name, f.type));
    if (!def || !fieldValueSchema(def).safeParse(f.value).success) continue;
    if (f.type === 'user' && !(await tx.get('users', f.value as string))) continue;
    await taskSetField(tx, { taskId, fieldId: def.id, value: f.value }, ctx);
  }
  const ranks = generateNKeysBetween(null, null, items.length);
  for (const [i, it] of items.entries())
    await checklistAdd(tx, { id: it.id, taskId, text: it.text, rank: ranks[i] }, ctx);
  return taskId;
}

async function makeTree(
  tx: Tx,
  ctx: MutatorCtx,
  env: Env,
  next: () => string,
  t: TaskTemplate,
  o: { statusId: string; rank: string; parentId?: string | null },
) {
  const taskId = await makeTask(tx, ctx, env, next, t, o);
  const ranks = generateNKeysBetween(null, null, t.subtasks.length);
  for (const [i, s] of t.subtasks.entries())
    await makeTask(tx, ctx, env, next, s, {
      statusId: o.statusId,
      rank: ranks[i]!,
      parentId: taskId,
    });
}

async function loadTemplate(tx: Tx, templateId: string, kind: TemplateKind) {
  const row = (await mtx(tx).get(E('templatesTemplates'), templateId)) as TemplateRow | undefined;
  if (!row) throw new MutatorError('not_found', `templatesTemplates ${templateId}`);
  if (row.kind !== kind) throw bad(`шаблон не ${kind}`);
  return row;
}

const parseData = (kind: TemplateKind, data: unknown) => {
  const r = dataSchema(kind).safeParse(data);
  if (!r.success) throw bad(`data: ${r.error.issues[0]?.message ?? 'неверный формат'}`);
  return r.data;
};

export const mutators = [
  defineMutator({
    name: 'templates.create',
    args: z.object({
      id,
      spaceId: id,
      kind: z.enum(['task', 'project']),
      name: templatesTemplates.shape.name,
      description: templatesTemplates.shape.description.optional(),
      data: z.json(),
    }),
    async run(tx, a, ctx) {
      if (!(await tx.get('spaces', a.spaceId)))
        throw new MutatorError('not_found', `spaces ${a.spaceId}`);
      await mtx(tx).put(E('templatesTemplates'), {
        ...a,
        description: a.description ?? null,
        data: parseData(a.kind, a.data),
        createdBy: ctx.userId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'templates.update',
    args: z.object({
      id,
      name: templatesTemplates.shape.name.optional(),
      description: templatesTemplates.shape.description.optional(),
      data: z.json().optional(),
    }),
    async run(tx, a, ctx) {
      const row = (await mtx(tx).get(E('templatesTemplates'), a.id)) as TemplateRow | undefined;
      if (!row) throw new MutatorError('not_found', `templatesTemplates ${a.id}`);
      await mtx(tx).patch(E('templatesTemplates'), a.id, {
        ...(a.name !== undefined && { name: a.name }),
        ...(a.description !== undefined && { description: a.description }),
        ...(a.data !== undefined && { data: parseData(row.kind, a.data) }),
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'templates.delete',
    args: z.object({ id }),
    async run(tx, a) {
      await mtx(tx).del(E('templatesTemplates'), a.id);
    },
  }),
  defineMutator({
    name: 'templates.createTask',
    args: z.object({
      templateId: id,
      projectId: id,
      statusId: id,
      rank: z.string().min(1),
      today: z.iso.date(),
      ids: z.array(id),
      parentId: id.nullable().optional(),
    }),
    async run(tx, a, ctx) {
      const tpl = await loadTemplate(tx, a.templateId, 'task');
      const project = await tx.get('projects', a.projectId);
      if (!project) throw new MutatorError('not_found', `projects ${a.projectId}`);
      if (project.spaceId !== tpl.spaceId) throw bad('шаблон другого пространства');
      const data = taskTemplateSchema.parse(tpl.data);
      const next = idSource(a.ids, templateIdPlan('task', data).count);
      const env = await loadEnv(tx, project.spaceId, project.id, a.today);
      await makeTree(tx, ctx, env, next, data, a);
    },
  }),
  defineMutator({
    name: 'templates.createProject',
    args: z.object({
      templateId: id,
      projectId: id,
      name: z.string().min(1).max(100),
      key: z.string(),
      rank: z.string().min(1),
      today: z.iso.date(),
      ids: z.array(id),
    }),
    async run(tx, a, ctx) {
      const tpl = await loadTemplate(tx, a.templateId, 'project');
      const data = projectTemplateSchema.parse(tpl.data);
      const next = idSource(a.ids, templateIdPlan('project', data).count);
      const spaceId = tpl.spaceId;
      await projectCreate(
        tx,
        { id: a.projectId, spaceId, name: a.name, key: a.key, rank: a.rank, ...data.project },
        ctx,
      );

      const statusIds = new Map<string, string>();
      for (const s of await tx.scan('statuses', { index: 'spaceId', eq: spaceId }))
        statusIds.set(norm(s.name), s.id);
      let last = (await tx.scan('statuses', { index: 'spaceId', eq: spaceId }))
        .map((s) => s.rank)
        .reduce<string | null>((m, r) => (m === null || r > m ? r : m), null);
      for (const s of data.statuses) {
        const sid = next();
        if (statusIds.has(norm(s.name))) continue;
        last = generateKeyBetween(last, null);
        await statusCreate(tx, { id: sid, spaceId, ...s, rank: last }, ctx);
        statusIds.set(norm(s.name), sid);
      }

      const env = await loadEnv(tx, spaceId, a.projectId, a.today);
      for (const l of data.labels) {
        const lid = next();
        if (env.labels.has(norm(l.name))) continue;
        await labelCreate(tx, { id: lid, spaceId, ...l }, ctx);
        env.labels.set(norm(l.name), lid);
      }

      const franks = generateNKeysBetween(null, null, data.fields.length);
      for (const [i, f] of data.fields.entries()) {
        const fid = next();
        await fieldCreate(tx, { id: fid, projectId: a.projectId, ...f, rank: franks[i] }, ctx);
        const def = await tx.get('fieldDefs', fid);
        if (def) env.fields.set(fieldKey(f.name, f.type), def as FieldDef);
      }

      const ranks = generateNKeysBetween(null, null, data.tasks.length);
      for (const [i, t] of data.tasks.entries())
        await makeTree(tx, ctx, env, next, t, {
          statusId: statusIds.get(norm(t.status))!,
          rank: ranks[i]!,
        });
    },
  }),
];

async function loadEnv(tx: Tx, spaceId: string, projectId: string, today: string): Promise<Env> {
  const labels = new Map<string, string>();
  for (const l of await tx.scan('labels', { index: 'spaceId', eq: spaceId }))
    labels.set(norm(l.name), l.id);
  const fields = new Map<string, FieldDef>();
  for (const f of await tx.scan('fieldDefs', { index: 'projectId', eq: projectId }))
    fields.set(fieldKey(f.name, f.type), f as FieldDef);
  return { spaceId, projectId, today, members: await loadMembers(tx, spaceId), labels, fields };
}

// --- save as a template (data from the replica)
export type Reader = Pick<Tx, 'get' | 'scan'>;
const byRank = (a: { rank: string }, b: { rank: string }) =>
  a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
const diff = (date: string | null, today: string) => {
  if (!date) return null;
  const n = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5,
  );
  return n < 0 ? null : n;
};

async function nodeOf(read: Reader, taskId: string, today: string): Promise<TemplateTask> {
  const t = await read.get('tasks', taskId);
  if (!t) throw new MutatorError('not_found', `tasks ${taskId}`);
  const [defs, tl, as, cl] = await Promise.all([
    read.scan('fieldDefs', { index: 'projectId', eq: t.projectId }),
    read.scan('taskLabels', { index: 'taskId', eq: taskId }),
    read.scan('taskAssignees', { index: 'taskId', eq: taskId }),
    read.scan('checklistItems', { index: 'taskId', eq: taskId }),
  ]);
  const labels = (await Promise.all(tl.map((x) => read.get('labels', x.labelId)))).flatMap((l) =>
    l ? [l.name] : [],
  );
  const fields = defs.flatMap((d) =>
    t.fields[d.id] === undefined ? [] : [{ name: d.name, type: d.type, value: t.fields[d.id] }],
  );
  return {
    title: t.title,
    description: t.description,
    priority: t.priority,
    dueInDays: diff(t.dueDate, today),
    startInDays: diff(t.startDate, today),
    fields: fields.slice(0, 50),
    labels: labels.slice(0, 50),
    assigneeIds: as.map((x) => x.userId).slice(0, 20),
    checklist: cl
      .sort(byRank)
      .map((x) => x.text)
      .slice(0, 100),
  };
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Task + direct children → TaskTemplate; `today` — the client's today (UTC by default). */
export async function taskToTemplate(
  taskId: string,
  read: Reader,
  today = todayUtc(),
): Promise<TaskTemplate> {
  const kids = (await read.scan('tasks', { index: 'parentId', eq: taskId })).sort(byRank);
  return {
    ...(await nodeOf(read, taskId, today)),
    subtasks: await Promise.all(kids.slice(0, 50).map((k) => nodeOf(read, k.id, today))),
  };
}

/** Project → ProjectTemplate: the space's statuses and labels, project fields, top-level tasks. */
export async function projectToTemplate(
  projectId: string,
  read: Reader,
  today = todayUtc(),
): Promise<ProjectTemplate> {
  const p = await read.get('projects', projectId);
  if (!p) throw new MutatorError('not_found', `projects ${projectId}`);
  const [sts, lbs, defs, tasks] = await Promise.all([
    read.scan('statuses', { index: 'spaceId', eq: p.spaceId }),
    read.scan('labels', { index: 'spaceId', eq: p.spaceId }),
    read.scan('fieldDefs', { index: 'projectId', eq: projectId }),
    read.scan('tasks', { index: 'projectId', eq: projectId }),
  ]);
  const statuses = sts.sort(byRank).slice(0, 30);
  const name = new Map(statuses.map((s) => [s.id, s.name]));
  const top = tasks
    .filter((t) => !t.parentId && name.has(t.statusId))
    .sort(byRank)
    .slice(0, 500);
  return {
    project: { description: p.description, color: p.color, icon: p.icon },
    statuses: statuses.map(({ name, category, color }) => ({ name, category, color })),
    labels: lbs.slice(0, 100).map(({ name, color }) => ({ name, color })),
    fields: defs
      .sort(byRank)
      .slice(0, 50)
      .map(({ name, type, options }) => ({ name, type, options })),
    tasks: await Promise.all(
      top.map(async (t) => ({
        ...(await taskToTemplate(t.id, read, today)),
        status: name.get(t.statusId)!,
      })),
    ),
  };
}

export const shared: SharedModuleManifest = {
  id: 'templates',
  mutators,
  entities: {
    templatesTemplates: {
      schema: templatesTemplates,
      meta: { scope: 'space', write: 'member', bootstrap: true, indexes: ['spaceId'] },
    },
  },
};
