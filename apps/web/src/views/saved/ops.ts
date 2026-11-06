import type { Row } from '@planar/shared';
import { db, mutate, newId, rankBetween } from '../../sync';
import type { Filter } from '../filter';
import type { ViewOptions } from '../options';

// reactive proxies don't suit mutation arguments — clone to plain JSON
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export async function saveView(a: {
  /** stable client id (autosave of a node view retries the same row) */
  id?: string;
  spaceId: string;
  personal: boolean;
  name: string;
  icon?: string | null;
  layout: string;
  /** a node's view of a built-in tab (w, s:<id>, p:<id>[:me-<mode>]) */
  node?: string;
  filter: Filter | null;
  config: ViewOptions;
}): Promise<string> {
  const id = a.id ?? newId();
  let last: string | null = null;
  await db
    .table<Row<'savedViews'>>('savedViews')
    .where('spaceId')
    .equals(a.spaceId)
    .each((v) => {
      if (last === null || v.rank > last) last = v.rank;
    });
  await mutate('view.create', {
    id,
    ...a,
    config: plain(a.config),
    filter: plain(a.filter ?? { op: 'and', rules: [] }),
    rank: rankBetween(last, null),
  });
  return id;
}

export const updateView = (
  id: string,
  p: { name?: string; icon?: string | null; filter?: Filter; config?: ViewOptions; rank?: string },
): Promise<void> => mutate('view.update', { id, ...plain(p) });

/** "Save for all": the shared default of a node tab; my personal row of it goes away. */
export const setNodeDefault = (a: {
  spaceId: string;
  node: string;
  layout: string;
  filter: Filter | null;
  config: ViewOptions;
}): Promise<void> =>
  mutate('view.setNodeDefault', {
    id: newId(),
    ...a,
    filter: plain(a.filter ?? { op: 'and', rules: [] }),
    config: plain(a.config),
  });

export const deleteView = (id: string): Promise<void> => mutate('view.delete', { id });
