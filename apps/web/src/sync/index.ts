import { generateKeyBetween } from 'fractional-indexing';
import { uuidv7 } from '@planar/shared';
import { createClient } from './client';
import { PlanarDB } from './db';

export const db = new PlanarDB('planar');
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
