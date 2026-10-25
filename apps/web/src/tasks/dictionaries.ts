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
 * Справочники (статусы, метки, участники пространства): один liveQuery на (вид, ключ) на всех подписчиков —
 * не по запросу на каждый пикер в каждой строке. После ухода последнего подписчика подписка живёт ещё `GRACE` мс:
 * возврат в проект того же пространства получает данные сразу, без чтения IndexedDB.
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
  (x.timer as unknown as { unref?: () => void }).unref?.(); // Node: не держать процесс
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

// ключ — id пространства или несколько через запятую (сводка группы)
const bySpace = <T>(table: string, s: string) => {
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

export const useStatuses = (spaceId: MaybeRefOrGetter<string>) =>
  useShared('st', () => toValue(spaceId), statuses);
export const useLabels = (spaceId: MaybeRefOrGetter<string>) =>
  useShared('lb', () => toValue(spaceId), labels);
export const useMembers = (spaceId: MaybeRefOrGetter<string>) =>
  useShared('mb', () => toValue(spaceId), members);

/** Заранее читает справочники пространства проекта, чтобы экран проекта получил их без чтения IndexedDB. */
export function warmSpace(spaceId: string): void {
  const warm = (key: string, fn: () => Promise<unknown>) => (retain(key, fn), release(key));
  warm('st' + spaceId, () => statuses(spaceId));
  warm('lb' + spaceId, () => labels(spaceId));
  warm('mb' + spaceId, () => members(spaceId));
}

/** для тестов: забыть справочники (тесты очищают базу напрямую) */
export function resetDictionaries(): void {
  for (const x of shared.values()) {
    clearTimeout(x.timer);
    x.sub.unsubscribe();
  }
  shared.clear();
}
