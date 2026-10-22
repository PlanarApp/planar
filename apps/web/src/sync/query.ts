import { liveQuery } from 'dexie';
import { getCurrentScope, onScopeDispose, readonly, shallowRef, type Ref } from 'vue';

/** Реактивный запрос к реплике: пересчитывается при изменении прочитанных таблиц. */
export function useQuery<T>(fn: () => T | Promise<T>): Readonly<Ref<T | undefined>> {
  const r = shallowRef<T>();
  const sub = liveQuery(fn).subscribe({ next: (v) => (r.value = v), error: () => {} });
  if (getCurrentScope()) onScopeDispose(() => sub.unsubscribe());
  return readonly(r) as Readonly<Ref<T | undefined>>;
}
