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

export interface BackendModuleManifest {
  id: string;
  /** класс Nest-модуля; shared не зависит от Nest */
  nestModule: unknown;
  mutators: MutatorDef[];
  entities: Record<string, ModuleEntity>;
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
}

export const MODULE_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
