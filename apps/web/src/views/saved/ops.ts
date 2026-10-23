import type { Row } from '@planar/shared';
import { db, mutate, newId, rankBetween } from '../../sync';
import type { Filter } from '../filter';
import type { ViewOptions } from '../options';

// реактивные прокси в аргументы мутации не годятся — клонируем в чистый JSON
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export async function saveView(a: {
  spaceId: string;
  personal: boolean;
  name: string;
  layout: string;
  filter: Filter | null;
  config: ViewOptions;
}): Promise<string> {
  const id = newId();
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
  p: { name?: string; filter?: Filter; config?: ViewOptions },
): Promise<void> => mutate('view.update', { id, ...plain(p) });

export const deleteView = (id: string): Promise<void> => mutate('view.delete', { id });
