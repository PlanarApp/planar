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
  /** строка до (провод); null — не было */
  before: Record<string, unknown> | null;
  /** строка после; null — удалена */
  after: Record<string, unknown> | null;
}
/** Мутация сделана правилом автоматизации. */
export interface MutationOrigin {
  ruleId: string;
  depth: number;
}
export interface AfterMutationCtx {
  userId: string;
  now: string;
  tokenId: string | null;
  mutator: string;
  /** выполнено от системы (обход прав) */
  system: boolean;
  origin: MutationOrigin | null;
}

export interface BackendModuleManifest {
  id: string;
  /** класс Nest-модуля; shared не зависит от Nest */
  nestModule: unknown;
  mutators: MutatorDef[];
  entities: Record<string, ModuleEntity>;
  /** api: ModuleHookApi (apps/api/src/modules/hooks.ts) */
  afterMutation?: (writes: MutationWrite[], ctx: AfterMutationCtx, api: never) => Promise<void>;
  /** JobDef[] (apps/api/src/modules/hooks.ts) */
  jobs?: unknown[];
}

/** Типы элементов задаёт web (C-ui); здесь — только форма манифеста. */
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
}

export const MODULE_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
