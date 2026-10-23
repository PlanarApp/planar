import { z } from 'zod';
import { entitySchemas } from '@planar/shared';

const uuid = z.uuid();
const date = z.iso.date();
const priority = z.number().int().min(0).max(4);

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export const projectsQuery = listQuery.extend({ spaceId: uuid.optional() });
export const tasksQuery = listQuery.extend({
  projectId: uuid.optional(),
  statusId: uuid.optional(),
  assigneeId: z.union([uuid, z.literal('me')]).optional(),
  updatedAfter: z.iso.datetime({ offset: true }).optional(),
});

export const createTaskBody = z.object({
  projectId: uuid,
  title: z.string().min(1).max(500),
  statusId: uuid.optional(),
  description: z.string().optional(),
  priority: priority.optional(),
  dueDate: date.nullable().optional(),
  assigneeIds: z.array(uuid).optional(),
  labelIds: z.array(uuid).optional(),
  parentId: uuid.nullable().optional(),
});
export const patchTaskBody = z.object({
  title: z.string().min(1).max(500).optional(),
  statusId: uuid.optional(),
  priority: priority.optional(),
  dueDate: date.nullable().optional(),
  startDate: date.nullable().optional(),
  description: z.string().nullable().optional(),
  assigneeIds: z.array(uuid).optional(),
  labelIds: z.array(uuid).optional(),
  parentId: uuid.nullable().optional(),
  fields: z.record(uuid, z.unknown()).optional(),
});
export const linkBody = z.object({
  target: z.string().min(1).describe('id или ключ целевой задачи'),
  kind: entitySchemas.taskLinks.shape.kind,
});
export const timeEntriesQuery = listQuery.extend({
  taskId: uuid.optional(),
  userId: z.union([uuid, z.literal('me')]).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export const timeLogBody = z.object({
  task: z.string().min(1),
  startedAt: z.iso.datetime(),
  durationSec: z.number().int().min(1).max(86400),
  note: z.string().max(1000).nullable().optional(),
});
export const timerStartBody = z.object({ task: z.string().min(1) });
export const commentBody = z.object({ text: z.string().min(1) });

export const {
  spaces: spaceSchema,
  projects: projectSchema,
  comments: commentSchema,
  fieldDefs: fieldDefSchema,
} = entitySchemas;
