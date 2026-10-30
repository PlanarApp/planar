import { liveQuery } from 'dexie';
import { getCurrentScope, onScopeDispose, shallowRef, type Ref } from 'vue';

/** Reactive query over the replica: recalculated when the read tables change. */
export function useQuery<T>(fn: () => T | Promise<T>): Readonly<Ref<T | undefined>> {
  const r = shallowRef<T>();
  const sub = liveQuery(fn).subscribe({ next: (v) => (r.value = v), error: () => {} });
  if (getCurrentScope()) onScopeDispose(() => sub.unsubscribe());
  return r as Readonly<Ref<T | undefined>>; // P10: readonly() wraps each element in a proxy
}
