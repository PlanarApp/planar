import {
  ENTITIES,
  createRegistry,
  domainMutators,
  type EntityMeta,
  type MutatorDef,
} from '@planar/shared';
import { enabledModules, type Reader } from '../modules/enabled.js';
import { installed } from '../modules/installed.js';

let core: Map<string, MutatorDef> | undefined;

/** Мутатор ядра или включённого модуля; выключенного модуля — undefined (unknown_mutator). */
export async function findMutator(q: Reader, name: string): Promise<MutatorDef | undefined> {
  core ??= createRegistry(domainMutators);
  const def = core.get(name);
  if (def) return def;
  const on = await enabledModules(q);
  return installed
    .filter((m) => on.has(m.api.id))
    .flatMap((m) => m.api.mutators)
    .find((d) => d.name === name);
}

/** Сущности ядра и включённых модулей. */
export async function visibleEntities(q: Reader): Promise<Record<string, EntityMeta>> {
  const on = await enabledModules(q);
  const out: Record<string, EntityMeta> = { ...ENTITIES };
  for (const m of installed)
    if (on.has(m.api.id))
      for (const [name, e] of Object.entries(m.api.entities)) out[name] = e.meta;
  return out;
}
