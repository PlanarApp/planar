import { liveQuery } from 'dexie';
import {
  getCurrentScope,
  onScopeDispose,
  readonly,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue';

/** liveQuery с реактивным аргументом: при его смене подписка пересоздаётся. */
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
      const s = liveQuery(() => fn(a)).subscribe({ next: (v) => (r.value = v), error: () => {} });
      unsub = () => s.unsubscribe();
    },
    { immediate: true, flush: 'sync' },
  );
  if (getCurrentScope()) onScopeDispose(() => unsub?.());
  return readonly(r) as Readonly<Ref<T | undefined>>;
}
