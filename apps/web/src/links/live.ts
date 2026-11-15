import { liveQuery } from 'dexie';
import {
  getCurrentScope,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue';
import { keep } from '../sync/query';

/** liveQuery with a reactive argument: the subscription is recreated when it changes. */
export function useLive<A, T>(
  arg: MaybeRefOrGetter<A>,
  fn: (a: A) => T | Promise<T>,
): Readonly<Ref<T | undefined>> {
  const r = shallowRef<T>();
  let unsub: (() => void) | undefined;
  watch(
    () => toValue(arg),
    (a) => {
      unsub?.();
      r.value = undefined;
      const s = liveQuery(() => fn(a)).subscribe({
        next: (v) => (r.value = keep(r.value, v)),
        error: () => {},
      });
      unsub = () => s.unsubscribe();
    },
    { immediate: true, flush: 'sync' },
  );
  if (getCurrentScope()) onScopeDispose(() => unsub?.());
  return r as Readonly<Ref<T | undefined>>; // P10: readonly() wraps each element in a proxy
}
