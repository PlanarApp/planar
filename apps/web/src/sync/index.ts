import { generateKeyBetween } from 'fractional-indexing';
import { uuidv7 } from './shared';
import { createClient } from './client';
import { PlanarDB } from './db';

export const db = new PlanarDB('planar');
const client = createClient(db);

export const {
  startSync,
  stopSync,
  mutate,
  registerMutators,
  syncState,
  onMutationError,
  onUnauthorized,
} = client;
export { useQuery } from './query';
export const newId = (): string => uuidv7();
export const rankBetween = (a: string | null, b: string | null): string => generateKeyBetween(a, b);
