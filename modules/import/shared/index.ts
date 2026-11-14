import { z } from 'zod';
import type { SharedModuleManifest } from '@planar/shared';

export const shared: SharedModuleManifest = { id: 'import', mutators: [], entities: {} };

export const FORMATS = ['csv', 'trello'] as const;
export const PRESETS = ['clickup', 'jira', 'linear', 'plane', 'custom', 'trello'] as const;
export type ImportFormat = (typeof FORMATS)[number];
export type ImportPreset = (typeof PRESETS)[number];

export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_ROWS = 20_000;

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
  statusMap: z.record(z.string(), z.uuid()).optional(),
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
}
