import type { z } from 'zod';
import type { EntityMeta } from './entities.js';
import type { MutatorDef } from './mutator.js';

export interface ModuleEntity {
  schema: z.ZodObject;
  meta: EntityMeta;
}

export interface SharedModuleManifest {
  id: string;
  mutators: MutatorDef[];
  entities: Record<string, ModuleEntity>;
}

export interface MutationWrite {
  entity: string;
  op: 'put' | 'del';
  /** row before (wire); null — there was none */
  before: Record<string, unknown> | null;
  /** row after; null — deleted */
  after: Record<string, unknown> | null;
}
/** Mutation made by an automation rule or an AI run. */
export interface MutationOrigin {
  ruleId?: string;
  aiRunId?: string;
  depth: number;
}
export interface AfterMutationCtx {
  userId: string;
  now: string;
  tokenId: string | null;
  mutator: string;
  /** executed by the system (bypasses permissions) */
  system: boolean;
  origin: MutationOrigin | null;
}

export interface BackendModuleManifest {
  id: string;
  /** Nest module class; shared does not depend on Nest */
  nestModule: unknown;
  mutators: MutatorDef[];
  entities: Record<string, ModuleEntity>;
  /** api: ModuleHookApi (apps/api/src/modules/hooks.ts) */
  afterMutation?: (writes: MutationWrite[], ctx: AfterMutationCtx, api: never) => Promise<void>;
  /** JobDef[] (apps/api/src/modules/hooks.ts) */
  jobs?: unknown[];
  /** File access beyond the built-in checks (GET /files); q — Drizzle connection/transaction */
  canReadFile?: (q: unknown, userId: string, sha256: string) => Promise<boolean>;
  /** null — the module can be enabled, a string — reason code (C-modules v11); q — Drizzle connection/transaction */
  unavailable?: (q: unknown) => Promise<string | null>;
}

/** Item types are set by web (C-ui); here only the manifest form. */
export interface FrontendModuleManifest {
  id: string;
  routes?: unknown[];
  views?: unknown[];
  taskPanels?: unknown[];
  commands?: unknown[];
  fieldTypes?: unknown[];
  settings?: unknown[];
  nav?: unknown[];
  topbar?: unknown[];
  search?: unknown[];
  /** Contents of group tabs (C-modules v12) */
  groupTabs?: unknown[];
  /** Module settings component (dialog in ModulesSettings, including for a disabled module) */
  setup?: unknown;
}

export const MODULE_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;

/** Data modules (C-schema v16): on or off per project in `projects.modules`; the other modules are shared (instance level). */
export const DATA_MODULE_IDS = [
  'gitlab',
  'sprints',
  'time',
  'forms',
  'recurring',
  'automations',
  'templates',
  'goals',
  'timeline',
  'workload',
  'dashboards',
  'docs',
  'ai',
] as const;

/** Data module → the modules it needs: they are turned on together, and the needed one cannot be turned off under it. */
export const MODULE_DEPS: Record<string, readonly string[]> = { ai: ['automations'] };

/** `modules` with the dependencies of each added (order kept, no duplicates). */
export const withModuleDeps = (modules: readonly string[]): string[] => [
  ...new Set(modules.flatMap((m) => [m, ...(MODULE_DEPS[m] ?? [])])),
];

export const isDataModule = (id: string): boolean =>
  (DATA_MODULE_IDS as readonly string[]).includes(id);
