import { z } from 'zod';
import type { SharedModuleManifest } from '@planar/shared';

export const shared: SharedModuleManifest = { id: 'import', mutators: [], entities: {} };

export const FORMATS = ['csv', 'trello'] as const;
export const PRESETS = ['clickup', 'jira', 'linear', 'plane', 'custom', 'trello'] as const;
export type ImportFormat = (typeof FORMATS)[number];
export type ImportPreset = (typeof PRESETS)[number];

export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_ROWS = 20_000;

/** projectMap/userMap value: create the project/user on import */
export const NEW = 'new';

const col = z.string().min(1);
export const mappingSchema = z.object({
  externalId: col.optional(),
  title: col,
  description: col.optional(),
  status: col.optional(),
  assignee: col.optional(),
  labels: col.optional(),
  dueDate: col.optional(),
  startDate: col.optional(),
  priority: col.optional(),
  parent: col.optional(),
  /** project column (Plane: Project Name): rows go to projects by projectMap, the rest — to the job's project */
  project: col.optional(),
  /** project key column (Plane: Project Identifier): the key of a created project */
  projectKey: col.optional(),
  /** comments column: a JSON array `[{comment, created_by, created_at}]` (Plane) */
  comments: col.optional(),
  statusMap: z.record(z.string(), z.uuid()).optional(),
  /** project value → project id in the job project's space, or `new` — create */
  projectMap: z.record(z.string(), z.union([z.uuid(), z.literal(NEW)])).optional(),
  /** person name (assignee, comment author) → user id, or `new` — create (instance admin only) */
  userMap: z.record(z.string(), z.union([z.uuid(), z.literal(NEW)])).optional(),
});
export type Mapping = z.infer<typeof mappingSchema>;

export interface ImportJob {
  id: string;
  userId: string;
  projectId: string;
  format: ImportFormat;
  preset: ImportPreset;
  status: 'pending' | 'running' | 'done' | 'failed';
  total: number;
  processed: number;
  created: number;
  updated: number;
  skipped: { row: number; reason: string }[];
  warnings: { row: number; message: string }[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Preview {
  columns: string[];
  rows: string[][];
  mapping: Mapping;
  /** distinct values over the whole file (not just the preview rows) by the mapping */
  values: {
    status: string[];
    /** project name → key (from projectKey, if mapped) */
    project: { name: string; key: string | null }[];
    /** assignees and comment authors */
    people: string[];
  };
}
