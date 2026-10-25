import { z } from 'zod';
import { MutatorError, defineMutator } from '../contract/index.js';
import { changes, color, delWhere, doc, name, need, rank, uuid } from './util.js';

const key = z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/);

export const projectMutators = [
  defineMutator({
    name: 'project.create',
    args: z.object({
      id: uuid,
      spaceId: uuid,
      name,
      key,
      rank,
      description: doc.nullable().optional(),
      color: color.nullable().optional(),
      icon: z.string().nullable().optional(),
      leadId: uuid.nullable().optional(),
    }),
    async run(tx, a, ctx) {
      await need(tx, 'spaces', a.spaceId);
      // корневое пространство — уровень Воркспейса: в нём только документы и чаты, проектов нет
      if ((await tx.get('settings', 'root_space'))?.value === a.spaceId)
        throw new MutatorError('invalid_args', 'в корневом пространстве нельзя создать проект');
      await tx.put('projects', {
        ...a,
        description: a.description ?? null,
        color: a.color ?? null,
        icon: a.icon ?? null,
        leadId: a.leadId ?? null,
        archivedAt: null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'project.update',
    args: z.object({
      id: uuid,
      name: name.optional(),
      key: key.optional(),
      description: doc.nullable().optional(),
      color: color.nullable().optional(),
      icon: z.string().nullable().optional(),
      leadId: uuid.nullable().optional(),
      rank: rank.optional(),
      archivedAt: z.iso.datetime().nullable().optional(),
    }),
    async run(tx, a, ctx) {
      await need(tx, 'projects', a.id);
      await tx.patch('projects', a.id, changes('projects', a, ctx));
    },
  }),
  defineMutator({
    name: 'project.delete',
    args: z.object({ id: uuid }),
    async run(tx, a) {
      await need(tx, 'projects', a.id);
      if ((await tx.scan('tasks', { index: 'projectId', eq: a.id })).length)
        throw new MutatorError('conflict', 'есть задачи');
      await delWhere(tx, 'fieldDefs', 'projectId', a.id);
      await tx.del('projects', a.id);
    },
  }),
];
