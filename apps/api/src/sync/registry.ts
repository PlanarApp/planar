import {
  ENTITIES,
  createRegistry,
  domainMutators,
  type EntityMeta,
  type MutatorDef,
} from '@planar/shared';

let registry: Map<string, MutatorDef> | undefined;
/** Мутаторы ядра; модули добавит CR-8. */
export const mutatorRegistry = (): Map<string, MutatorDef> =>
  (registry ??= createRegistry(domainMutators));

/** Сущности включённых модулей (пока только ядро; модули добавит CR-8). */
export const visibleEntities = (): Record<string, EntityMeta> => ENTITIES;
