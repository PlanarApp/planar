import { z } from 'zod';
import type { SharedModuleManifest } from '@planar/shared';

export const shared: SharedModuleManifest = { id: 'import', mutators: [], entities: {} };

/** formats with a file; plane-api reads the Plane API (PLNRAPP-874) */
export const FILE_FORMATS = ['csv', 'trello'] as const;
export const FORMATS = [...FILE_FORMATS, 'plane-api'] as const;
export const PRESETS = ['clickup', 'jira', 'linear', 'plane', 'custom', 'trello'] as const;
export type ImportFormat = (typeof FORMATS)[number];
export type FileFormat = (typeof FILE_FORMATS)[number];
export type ImportPreset = (typeof PRESETS)[number];

export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_ROWS = 20_000;

/** projectMap/userMap value: create the project/user on import */
export const NEW = 'new';

export const STATUS_CATEGORIES = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

// the first match wins: «К работе» is todo, not in progress
const CATEGORY_HINTS: [StatusCategory, RegExp][] = [
  ['cancelled', /cancel|отмен|reject|отклон|won'?t|duplicate|дубл/i],
  ['done', /done|complete|closed|resolved|finish|released|deployed|готов|выполн|закрыт|сделано/i],
  ['backlog', /backlog|бэклог|icebox|idea|идея|later|потом/i],
  ['todo', /\bto ?do\b|\bopen\b|\bnew\b|к работе|сделать|нов/i],
  ['in_progress', /progress|review|test|\bdev|qa|doing|block|wait|ревью|тест|работ|ожид|провер/i],
];
/** Category of a created status by its name; unknown — todo. */
export const guessCategory = (name: string): StatusCategory =>
  CATEGORY_HINTS.find(([, re]) => re.test(name))?.[0] ?? 'todo';

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
  /** project column (Plane: Project Name): rows go to projects by projectMap, the rest — to the job's project (none — skipped) */
  project: col.optional(),
  /** project key column (Plane: Project Identifier): the key of a created project */
  projectKey: col.optional(),
  /** comments column: a JSON array `[{comment, created_by, created_at}]` (Plane) */
  comments: col.optional(),
  statusMap: z.record(z.string(), z.uuid()).optional(),
  /** status value → category: created in every project of its rows that has no status of that name */
  statusNew: z.record(z.string(), z.enum(STATUS_CATEGORIES)).optional(),
  /** project value → project id in the import space, or `new` — create */
  projectMap: z.record(z.string(), z.union([z.uuid(), z.literal(NEW)])).optional(),
  /** person name (assignee, comment author) → user id, or `new` — create (instance admin only) */
  userMap: z.record(z.string(), z.union([z.uuid(), z.literal(NEW)])).optional(),
});
export type Mapping = z.infer<typeof mappingSchema>;

export interface ImportJob {
  id: string;
  userId: string;
  projectId: string | null;
  spaceId: string | null;
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

/** A server certificate not trusted by Planar (Plane API, PLNRAPP-877) */
export interface PlaneCert {
  subject: string;
  issuer: string;
  validTo: string;
  /** SHA-256, `AB:CD:…` as Node gives it */
  fingerprint256: string;
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
    /** person → e-mail, when the source knows it (Plane API): a hint for matching */
    emails?: Record<string, string>;
  };
  /** Plane API: the certificate is not trusted — nothing was read; trust it by fingerprint and repeat */
  certificate?: PlaneCert;
}
