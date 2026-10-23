import { generateKeyBetween } from 'fractional-indexing';
import { uuidv7 } from '@planar/shared';
import { createClient } from './client';
import { moduleIndexes } from '../modules/shared';
import { PlanarDB } from './db';

export const db = new PlanarDB('planar', moduleIndexes);
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
  sendTyping,
  onTyping,
} = client;
export { useQuery } from './query';
export const newId = (): string => uuidv7();
export const rankBetween = (a: string | null, b: string | null): string => generateKeyBetween(a, b);
export type { ReplicaChange } from './db';
