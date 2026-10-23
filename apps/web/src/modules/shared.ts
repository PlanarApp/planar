import type { ModuleEntity, SharedModuleManifest } from '@planar/shared';

/** Общая часть всех установленных модулей (сущности и мутаторы) — нужна реплике независимо от включения. */
const found = import.meta.glob<{ shared: SharedModuleManifest }>(
  '../../../../modules/*/shared/index.ts',
  { eager: true },
);
export const sharedModules: SharedModuleManifest[] = Object.values(found).map((m) => m.shared);
export const moduleMutators = sharedModules.flatMap((m) => m.mutators);
export const moduleEntities: Record<string, ModuleEntity> = Object.assign(
  {},
  ...sharedModules.map((m) => m.entities),
);
/** Таблицы Dexie сущностей модулей: имя -> индексы */
export const moduleIndexes: Record<string, string[]> = Object.fromEntries(
  sharedModules.flatMap((m) => Object.entries(m.entities).map(([n, e]) => [n, e.meta.indexes])),
);
