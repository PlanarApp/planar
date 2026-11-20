import { z } from 'zod';
import { entitySchemas } from './entities.js';

// API v1 (docs/contracts/core-api-v1.md): tokens and REST.
const ts = z.iso.datetime();

export const apiTokenSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  prefix: z.string().length(8),
  scope: z.enum(['read', 'write']),
  expiresAt: ts.nullable(),
  lastUsedAt: ts.nullable(),
  revokedAt: ts.nullable(),
  createdAt: ts,
});

export const apiTokenCreatedSchema = z.object({
  token: apiTokenSchema,
  secret: z.string().regex(/^plnr_[0-9A-Za-z]{43}$/),
});

/** PLNRAPP-576: assigned comments of the task itself (subtasks are not counted) */
export const assignedCommentsSchema = z.object({
  /** assigned to anyone */
  total: z.number().int().min(0),
  /** of them resolved */
  resolved: z.number().int().min(0),
  /** there is an open comment assigned to the current user */
  assignedToMe: z.boolean(),
});
export type AssignedComments = z.infer<typeof assignedCommentsSchema>;

/** counters of a tasks row for the user (no user — assignedToMe false); replica rows before C-schema v30 — zeros */
export function assignedCommentsOf(
  t: { commentsAssigned?: number; commentsResolved?: number; commentsOpenAssignees?: string[] },
  userId?: string | null,
): AssignedComments {
  return {
    total: t.commentsAssigned ?? 0,
    resolved: t.commentsResolved ?? 0,
    assignedToMe: !!userId && (t.commentsOpenAssignees ?? []).includes(userId),
  };
}

export const v1TaskSchema = entitySchemas.tasks.extend({
  key: z.string().nullable(),
  assigneeIds: z.array(z.uuid()),
  labelIds: z.array(z.uuid()),
  assignedComments: assignedCommentsSchema,
});

export type ApiToken = z.infer<typeof apiTokenSchema>;
export type V1Task = z.infer<typeof v1TaskSchema>;
