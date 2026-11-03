import { z } from 'zod';
import { defineMutator, type Row, type Tx } from '../contract/index.js';
import { checkFields } from './fields.js';
import {
  bad,
  changes,
  completedAt,
  date,
  delWhere,
  doc,
  need,
  rank,
  record,
  uuid,
} from './util.js';

const priority = z.number().int().min(0).max(4);

/** Task `parentId` — in the same space, not `taskId` itself and not its descendant. */
async function checkParent(tx: Tx, taskId: string, spaceId: string, parentId: string) {
  let p: Row<'tasks'> | undefined = await need(tx, 'tasks', parentId);
  if (p.spaceId !== spaceId) throw bad('parentId другого пространства');
  const seen = new Set<string>();
  while (p && !seen.has(p.id)) {
    if (p.id === taskId) throw bad('parentId — сама задача или потомок');
    seen.add(p.id);
    p = p.parentId ? await tx.get('tasks', p.parentId) : undefined;
  }
}

export async function deleteTask(tx: Tx, id: string) {
  for (const c of await tx.scan('tasks', { index: 'parentId', eq: id })) await deleteTask(tx, c.id);
  for (const e of [
    'taskAssignees',
    'taskWatchers',
    'taskLabels',
    'checklistItems',
    'attachments',
  ] as const)
    await delWhere(tx, e, 'taskId', id);
  for (const c of await tx.scan('comments', { index: 'taskId', eq: id })) {
    await delWhere(tx, 'commentReactions', 'commentId', c.id);
    await tx.del('comments', c.id);
  }
  for (const i of ['taskId', 'targetId']) await delWhere(tx, 'taskLinks', i, id);
  await tx.del('tasks', id);
}

/** Status of the new project for a moved task: same name, else same category (lowest rank), else the first by rank. */
async function remapStatus(tx: Tx, oldId: string, projectId: string) {
  const old = await need(tx, 'statuses', oldId);
  const list = (await tx.scan('statuses', { index: 'projectId', eq: projectId })).sort((x, y) =>
    x.rank < y.rank ? -1 : x.rank > y.rank ? 1 : 0,
  );
  const hit =
    list.find((s) => s.name.toLowerCase() === old.name.toLowerCase()) ??
    list.find((s) => s.category === old.category) ??
    list[0];
  if (!hit) throw bad('в проекте нет статусов');
  return hit;
}

/** Labels of a moved task: by name (case-insensitive) in the new project; no counterpart (or a duplicate) — the link is dropped. */
async function remapLabels(tx: Tx, taskId: string, projectId: string) {
  const byName = new Map(
    (await tx.scan('labels', { index: 'projectId', eq: projectId })).map((l) => [
      l.name.toLowerCase(),
      l.id,
    ]),
  );
  const used = new Set<string>();
  for (const x of await tx.scan('taskLabels', { index: 'taskId', eq: taskId })) {
    const old = await tx.get('labels', x.labelId);
    const to = old && old.projectId !== projectId ? byName.get(old.name.toLowerCase()) : x.labelId;
    if (to && !used.has(to)) {
      used.add(to);
      if (to !== x.labelId) await tx.patch('taskLabels', x.id, { labelId: to });
    } else await tx.del('taskLabels', x.id);
  }
}

const link = (tx: Tx, entity: 'taskAssignees' | 'taskWatchers', taskId: string) =>
  tx.scan(entity, { index: 'taskId', eq: taskId });

export const taskMutators = [
  defineMutator({
    name: 'task.create',
    args: z.object({
      id: uuid,
      projectId: uuid,
      statusId: uuid,
      title: z.string().min(1).max(500),
      rank,
      parentId: uuid.nullable().optional(),
      description: doc.nullable().optional(),
      priority: priority.optional(),
      dueDate: date.nullable().optional(),
      startDate: date.nullable().optional(),
      assignees: z.array(z.object({ id: uuid, userId: uuid })).optional(),
      labels: z.array(z.object({ id: uuid, labelId: uuid })).optional(),
    }),
    async run(tx, a, ctx) {
      const project = await need(tx, 'projects', a.projectId);
      const spaceId = project.spaceId;
      const status = await need(tx, 'statuses', a.statusId);
      if (status.projectId !== a.projectId) throw bad('statusId другого проекта');
      if (a.parentId) await checkParent(tx, a.id, spaceId, a.parentId);
      for (const l of a.labels ?? []) {
        if ((await need(tx, 'labels', l.labelId)).projectId !== a.projectId)
          throw bad('labelId другого проекта');
      }
      await tx.put('tasks', {
        id: a.id,
        spaceId,
        projectId: a.projectId,
        number: null,
        parentId: a.parentId ?? null,
        statusId: a.statusId,
        title: a.title,
        description: a.description ?? null,
        priority: a.priority ?? 0,
        rank: a.rank,
        dueDate: a.dueDate ?? null,
        startDate: a.startDate ?? null,
        createdBy: ctx.userId,
        completedAt: completedAt(status.category, null, ctx),
        fields: {},
        cycleId: null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
      for (const x of a.assignees ?? [])
        await tx.put('taskAssignees', { ...x, spaceId, taskId: a.id, createdAt: ctx.now });
      for (const x of a.labels ?? [])
        await tx.put('taskLabels', { ...x, spaceId, taskId: a.id, createdAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'task.update',
    args: z.object({
      id: uuid,
      title: z.string().min(1).max(500).optional(),
      description: doc.nullable().optional(),
      statusId: uuid.optional(),
      priority: priority.optional(),
      rank: rank.optional(),
      dueDate: date.nullable().optional(),
      startDate: date.nullable().optional(),
      projectId: uuid.optional(),
      parentId: uuid.nullable().optional(),
      fields: record.optional(),
    }),
    async run(tx, a, ctx) {
      const t = await need(tx, 'tasks', a.id);
      const patch = changes('tasks', a, ctx);
      const moved = !!a.projectId && a.projectId !== t.projectId;
      if (a.projectId) {
        const p = await need(tx, 'projects', a.projectId);
        if (p.spaceId !== t.spaceId) throw bad('projectId другого пространства');
        if (moved) {
          patch.number = null;
          patch.cycleId = null;
          if (!a.fields) patch.fields = {};
        }
      }
      const projectId = a.projectId ?? t.projectId;
      let st = a.statusId ? await need(tx, 'statuses', a.statusId) : undefined;
      if (st && st.projectId !== projectId) throw bad('statusId другого проекта');
      if (moved) {
        st ??= await remapStatus(tx, t.statusId, projectId);
        patch.statusId = st.id;
        await remapLabels(tx, t.id, projectId);
      }
      if (st) patch.completedAt = completedAt(st.category, t.completedAt, ctx);
      if (a.fields) await checkFields(tx, a.projectId ?? t.projectId, a.fields);
      if (a.parentId) await checkParent(tx, t.id, t.spaceId, a.parentId);
      await tx.patch('tasks', a.id, patch);
    },
  }),
  defineMutator({
    name: 'task.delete',
    args: z.object({ id: uuid }),
    async run(tx, a) {
      await need(tx, 'tasks', a.id);
      await deleteTask(tx, a.id);
    },
  }),
  defineMutator({
    name: 'task.assign',
    args: z.object({ id: uuid, taskId: uuid, userId: uuid }),
    async run(tx, a, ctx) {
      const t = await need(tx, 'tasks', a.taskId);
      if ((await link(tx, 'taskAssignees', t.id)).some((x) => x.userId === a.userId)) return;
      await tx.put('taskAssignees', { ...a, spaceId: t.spaceId, createdAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'task.unassign',
    args: z.object({ taskId: uuid, userId: uuid }),
    async run(tx, a) {
      await need(tx, 'tasks', a.taskId);
      for (const x of await link(tx, 'taskAssignees', a.taskId))
        if (x.userId === a.userId) await tx.del('taskAssignees', x.id);
    },
  }),
  defineMutator({
    name: 'task.watch',
    args: z.object({ id: uuid, taskId: uuid }),
    async run(tx, a, ctx) {
      const t = await need(tx, 'tasks', a.taskId);
      if ((await link(tx, 'taskWatchers', t.id)).some((x) => x.userId === ctx.userId)) return;
      await tx.put('taskWatchers', {
        id: a.id,
        spaceId: t.spaceId,
        taskId: t.id,
        userId: ctx.userId,
        createdAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'task.unwatch',
    args: z.object({ taskId: uuid }),
    async run(tx, a, ctx) {
      await need(tx, 'tasks', a.taskId);
      for (const x of await link(tx, 'taskWatchers', a.taskId))
        if (x.userId === ctx.userId) await tx.del('taskWatchers', x.id);
    },
  }),
  defineMutator({
    name: 'task.addLabel',
    args: z.object({ id: uuid, taskId: uuid, labelId: uuid }),
    async run(tx, a, ctx) {
      const t = await need(tx, 'tasks', a.taskId);
      const l = await need(tx, 'labels', a.labelId);
      if (l.projectId !== t.projectId) throw bad('labelId другого проекта');
      const have = await tx.scan('taskLabels', { index: 'taskId', eq: t.id });
      if (have.some((x) => x.labelId === l.id)) return;
      await tx.put('taskLabels', { ...a, spaceId: t.spaceId, createdAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'task.removeLabel',
    args: z.object({ taskId: uuid, labelId: uuid }),
    async run(tx, a) {
      await need(tx, 'tasks', a.taskId);
      for (const x of await tx.scan('taskLabels', { index: 'taskId', eq: a.taskId }))
        if (x.labelId === a.labelId) await tx.del('taskLabels', x.id);
    },
  }),
];
