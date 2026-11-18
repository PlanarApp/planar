import { liveQuery } from 'dexie';
import { getCurrentScope, onScopeDispose, shallowRef, type Ref } from 'vue';

const plain = (x: object) => {
  const p = Object.getPrototypeOf(x);
  return p === Object.prototype || p === null;
};

/**
 * next with unchanged parts taken from prev (structural sharing): equal → prev itself, so Vue
 * re-renders only what changed. Array elements with id are matched by id, others by position.
 */
export function keep<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return prev as T;
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') return next;
  if (Array.isArray(prev) && Array.isArray(next)) {
    const byId = new Map<unknown, unknown>();
    for (const x of prev) if (x && typeof x === 'object' && 'id' in x) byId.set(x.id, x);
    let all = prev.length === next.length;
    const out = next.map((x, i) => {
      const k = keep(x && typeof x === 'object' && 'id' in x ? byId.get(x.id) : prev[i], x);
      if (k !== prev[i]) all = false;
      return k;
    });
    return (all ? prev : out) as T;
  }
  if (prev instanceof Set && next instanceof Set)
    return (prev.size === next.size && [...next].every((x) => prev.has(x)) ? prev : next) as T;
  if (prev instanceof Map && next instanceof Map) {
    let all = prev.size === next.size;
    const out = new Map();
    for (const [k, v] of next) {
      const kv = keep(prev.get(k), v);
      if (kv !== prev.get(k) || !prev.has(k)) all = false;
      out.set(k, kv);
    }
    return (all ? prev : out) as T;
  }
  if (prev instanceof Date && next instanceof Date)
    return (prev.getTime() === next.getTime() ? prev : next) as T;
  if (Array.isArray(prev) || Array.isArray(next) || !plain(prev) || !plain(next)) return next;
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  let all = Object.keys(p).length === Object.keys(n).length;
  const out: Record<string, unknown> = {};
  for (const k in n) {
    out[k] = keep(p[k], n[k]);
    if (out[k] !== p[k] || !(k in p)) all = false;
  }
  return (all ? prev : out) as T;
}

/** Deep equality of rows and query results (key order does not matter). */
export const same = (a: unknown, b: unknown): boolean => keep(a, b) === a;

/** Reactive query over the replica: recalculated when the read tables change. */
export function useQuery<T>(fn: () => T | Promise<T>): Readonly<Ref<T | undefined>> {
  const r = shallowRef<T>();
  // an equal result keeps the old object — shallowRef does not trigger
  const sub = liveQuery(fn).subscribe({
    next: (v) => (r.value = keep(r.value, v)),
    // after an error liveQuery stops: the screen goes stale, so at least leave a trace
    error: (e) => console.error('useQuery', e),
  });
  if (getCurrentScope()) onScopeDispose(() => sub.unsubscribe());
  return r as Readonly<Ref<T | undefined>>; // P10: readonly() wraps each element in a proxy
}
