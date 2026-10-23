import { generateKeyBetween } from 'fractional-indexing';
import { uuidv7, type SharedModuleManifest } from '@planar/shared';
import { createClient } from './client';
import { registerModuleEntities } from './dexie-tx';
import { PlanarDB } from './db';

// shared-манифесты установленных модулей (без Node API, малые): сущности и мутаторы клиента
const manifests = Object.values(
  import.meta.glob<{ shared: SharedModuleManifest }>('../../../../modules/*/shared/index.ts', {
    eager: true,
  }),
).map((m) => m.shared);
manifests.forEach((m) => registerModuleEntities(m.entities));
export const moduleMutators = manifests.flatMap((m) => m.mutators);

/** Сущности модулей → индексы Dexie. */
export const moduleIndexes = (list: SharedModuleManifest[]): Record<string, string[]> =>
  Object.fromEntries(
    list.flatMap((m) => Object.entries(m.entities).map(([n, e]) => [n, e.meta.indexes] as const)),
  );

export const db = new PlanarDB('planar', moduleIndexes(manifests));
const client = createClient(db);

export const {
  startSync,
  stopSync,
  clearLocal,
  mutate,
  registerMutators,
  syncState,
  onMutationError,
  onUnauthorized,
  onReplicaChange,
  replicaState,
} = client;
export { useQuery } from './query';
export const newId = (): string => uuidv7();
export const rankBetween = (a: string | null, b: string | null): string => generateKeyBetween(a, b);
export type { ReplicaChange } from './db';
