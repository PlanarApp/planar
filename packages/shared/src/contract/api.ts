import { z } from 'zod';
import { entitySchemas } from './entities.js';

// API v1 (docs/contracts/core-api-v1.md): токены и REST.
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

export const v1TaskSchema = entitySchemas.tasks.extend({
  key: z.string().nullable(),
  assigneeIds: z.array(z.uuid()),
  labelIds: z.array(z.uuid()),
});

export type ApiToken = z.infer<typeof apiTokenSchema>;
export type V1Task = z.infer<typeof v1TaskSchema>;
