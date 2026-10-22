import { z } from 'zod';
import { defineMutator, type Row, type Tx } from '../contract/index.js';
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

/** Задача `parentId` — в том же пространстве, не сама `taskId` и не её потомок. */
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

async function deleteTask(tx: Tx, id: string) {
  for (const c of await tx.scan('tasks', { index: 'parentId', eq: id })) await deleteTask(tx, c.id);
  for (const e of [
    'taskAssignees',
    'taskWatchers',
    'taskLabels',
    'checklistItems',
    'attachments',
    'comments',
  ] as const)
    await delWhere(tx, e, 'taskId', id);
  await tx.del('tasks', id);
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
      if (status.spaceId !== spaceId) throw bad('statusId другого пространства');
      if (a.parentId) await checkParent(tx, a.id, spaceId, a.parentId);
      for (const l of a.labels ?? []) {
        if ((await need(tx, 'labels', l.labelId)).spaceId !== spaceId)
          throw bad('labelId другого пространства');
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
      if (a.statusId) {
        const st = await need(tx, 'statuses', a.statusId);
        if (st.spaceId !== t.spaceId) throw bad('statusId другого пространства');
        patch.completedAt = completedAt(st.category, t.completedAt, ctx);
      }
      if (a.projectId) {
        const p = await need(tx, 'projects', a.projectId);
        if (p.spaceId !== t.spaceId) throw bad('projectId другого пространства');
        if (a.projectId !== t.projectId) patch.number = null;
      }
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
      if (l.spaceId !== t.spaceId) throw bad('labelId другого пространства');
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
