import { computed, onScopeDispose, ref, watch } from 'vue';
import { liveQuery } from 'dexie';
import { db, mutate, onMutationError } from '@planar/web/modules';
import { LOCK_RENEW_MS, lockedBy, type LockRow } from './model';

/**
 * Мягкая блокировка страницы: docs.lock при открытии, продление раз в минуту, docs.unlock при уходе.
 * `other` — userId редактирующего другого (или '' если отказ сервера, а строки блокировки ещё нет).
 */
export function useLock(pageId: () => string, me: () => string | undefined) {
  const row = ref<LockRow>();
  const rejected = ref(false);
  const tick = ref(Date.now());
  let held: string | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let sub: { unsubscribe(): void } | undefined;

  const acquire = async (id: string) => {
    try {
      await mutate('docs.lock', { pageId: id });
      if (pageId() === id) {
        rejected.value = false;
        held = id;
      }
    } catch {
      rejected.value = true; // локальный мутатор увидел чужую блокировку
    }
  };
  const release = () => {
    if (held) void mutate('docs.unlock', { pageId: held }).catch(() => {});
    held = null;
  };

  const offErr = onMutationError((e) => {
    if (e.name === 'docs.lock' && e.code === 'conflict') rejected.value = true;
  });
  const stop = watch(
    pageId,
    (id) => {
      release();
      sub?.unsubscribe();
      clearInterval(timer);
      rejected.value = false;
      row.value = undefined;
      if (!id) return;
      sub = liveQuery(() => db.table<LockRow>('docsLocks').get(id)).subscribe({
        next: (r) => ((row.value = r), (tick.value = Date.now())),
        error: () => {},
      });
      void acquire(id);
      timer = setInterval(() => {
        tick.value = Date.now();
        void acquire(id);
      }, LOCK_RENEW_MS);
    },
    { immediate: true },
  );
  const onHide = () => release();
  window.addEventListener('pagehide', onHide);
  onScopeDispose(() => {
    stop();
    offErr();
    sub?.unsubscribe();
    clearInterval(timer);
    window.removeEventListener('pagehide', onHide);
    release();
  });

  const other = computed(() => {
    const u = me();
    return (
      lockedBy(row.value, u ?? '', tick.value) ??
      (rejected.value ? (row.value && row.value.userId !== u ? row.value.userId : '') : null)
    );
  });
  return { other, editable: computed(() => other.value === null) };
}
