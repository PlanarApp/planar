import { liveQuery, type Subscription } from 'dexie';
import { getCurrentScope, onScopeDispose, shallowRef, toValue, watch } from 'vue';
import type { MaybeRefOrGetter, Ref, WatchHandle } from 'vue';
import type { Row } from '@planar/shared';
import { db } from '../sync';

export const byStr =
  <T>(f: (x: T) => string) =>
  (a: T, b: T) =>
    f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0;
export const byRank = byStr<{ rank: string }>((x) => x.rank);

/**
 * Dictionaries (statuses, labels, space members): one liveQuery per (kind, key) for all subscribers —
 * not a query per picker in every row. After the last subscriber leaves, the subscription lives on for `GRACE` ms:
 * returning to a project of the same space gets the data at once, without reading IndexedDB.
 */
const GRACE = 5 * 60_000;
interface Shared {
  r: Ref<unknown>;
  sub: Subscription;
  n: number;
  timer?: ReturnType<typeof setTimeout>;
}
const shared = new Map<string, Shared>();

function retain<T>(key: string, fn: () => Promise<T>): Shared {
  let x = shared.get(key);
  if (!x) {
    const r = shallowRef<T>();
    const sub = liveQuery(fn).subscribe({ next: (v) => (r.value = v), error: () => {} });
    shared.set(key, (x = { r, sub, n: 0 }));
  }
  clearTimeout(x.timer);
  x.n++;
  return x;
}
function release(key: string): void {
  const x = shared.get(key);
  if (!x || --x.n > 0) return;
  x.timer = setTimeout(() => {
    x.sub.unsubscribe();
    shared.delete(key);
  }, GRACE);
  (x.timer as unknown as { unref?: () => void }).unref?.(); // Node: don't keep the process alive
}

function useShared<T>(kind: string, arg: () => string, fn: (a: string) => Promise<T>) {
  const out = shallowRef<T>();
  let key = '';
  let follow: WatchHandle | undefined;
  const drop = () => {
    follow?.stop();
    if (key) release(key);
  };
  const stop = watch(
    arg,
    (a) => {
      drop();
      key = kind + a;
      const x = retain(key, () => fn(a));
      out.value = x.r.value as T;
      follow = watch(x.r, (v) => (out.value = v as T), { flush: 'sync' });
    },
    { immediate: true, flush: 'sync' },
  );
  if (getCurrentScope())
    onScopeDispose(() => {
      stop();
      drop();
    });
  return out as Readonly<Ref<T | undefined>>;
}

// key — a space id or several comma-separated (group summary)
// "p:<projectId>" — the project's own dictionary (statuses and labels belong to a project)
const bySpace = <T>(table: string, s: string) => {
  if (s.startsWith('p:')) return db.table<T>(table).where('projectId').equals(s.slice(2)).toArray();
  const w = db.table<T>(table).where('spaceId');
  return (s.includes(',') ? w.anyOf(s.split(',')) : w.equals(s)).toArray();
};
const statuses = async (s: string) => (await bySpace<Row<'statuses'>>('statuses', s)).sort(byRank);
const labels = async (s: string) =>
  (await bySpace<Row<'labels'>>('labels', s)).sort(byStr((l) => l.name));
const members = async (s: string) => {
  const ms = await bySpace<Row<'spaceMembers'>>('spaceMembers', s);
  const us = await db.table<Row<'users'>>('users').bulkGet([...new Set(ms.map((m) => m.userId))]);
  return us
    .filter((u): u is Row<'users'> => !!u && !u.deactivatedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
};

type Maybe = MaybeRefOrGetter<string | undefined>;
const scopeKey = (spaceId: MaybeRefOrGetter<string>, projectId?: Maybe) => () => {
  const p = toValue(projectId);
  return p ? `p:${p}` : toValue(spaceId);
};
/** with `projectId` — the project's own statuses; without — of the space(s), the same names repeat across projects */
export const useStatuses = (spaceId: MaybeRefOrGetter<string>, projectId?: Maybe) =>
  useShared('st', scopeKey(spaceId, projectId), statuses);
export const useLabels = (spaceId: MaybeRefOrGetter<string>, projectId?: Maybe) =>
  useShared('lb', scopeKey(spaceId, projectId), labels);
export const useMembers = (spaceId: MaybeRefOrGetter<string>) =>
  useShared('mb', () => toValue(spaceId), members);

export const normName = (name: string) => name.trim().toLowerCase();

/** Summary of several projects: same-named rows (case-insensitive) are one item, the first one represents it. */
export function uniqByName<T extends { name: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(normName(r.name)) && !!seen.add(normName(r.name)));
}

/** Pre-reads the dictionaries of the project's space so the project screen gets them without reading IndexedDB. */
export function warmSpace(spaceId: string): void {
  const warm = (key: string, fn: () => Promise<unknown>) => (retain(key, fn), release(key));
  warm('st' + spaceId, () => statuses(spaceId));
  warm('lb' + spaceId, () => labels(spaceId));
  warm('mb' + spaceId, () => members(spaceId));
}

/** for tests: forget the dictionaries (tests clear the database directly) */
export function resetDictionaries(): void {
  for (const x of shared.values()) {
    clearTimeout(x.timer);
    x.sub.unsubscribe();
  }
  shared.clear();
}
