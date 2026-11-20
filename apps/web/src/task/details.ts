import { getCurrentScope, onScopeDispose, ref, watch, type Ref } from 'vue';
import { db, ensureTask, syncState } from '../sync';

/** C-sync v3 (PLNRAPP-487): the details of a task (comments, reactions) in the replica. */
export type DetailsState = 'loading' | 'ready' | 'offline';

/**
 * true — the details of the task are in the replica (held or just loaded via `POST /sync/tasks`);
 * false — not loaded: no network, sync not started or the snapshot stayed stale.
 */
export async function loadDetails(taskId: string): Promise<boolean> {
  try {
    return await ensureTask(taskId);
  } catch {
    // sync not started / network error: what is held stays complete without the network
    return !!(await db._held.get(taskId));
  }
}

/** Loads the details of the task on open; while loading — `loading`, failed — `offline`, a retry when the sync is back online. */
export function useTaskDetails(taskId: string): Readonly<Ref<DetailsState>> {
  const state = ref<DetailsState>('loading');
  let busy = false;
  let stopped = false;
  async function run() {
    if (busy || stopped || state.value === 'ready') return;
    busy = true;
    const ok = await loadDetails(taskId);
    busy = false;
    if (!stopped) state.value = ok ? 'ready' : 'offline';
  }
  void run();
  const stop = watch(
    () => syncState.value.status,
    (s) => s === 'online' && void run(),
  );
  if (getCurrentScope())
    onScopeDispose(() => {
      stopped = true;
      stop();
    });
  return state;
}
