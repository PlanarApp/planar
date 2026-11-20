import { SYNC_TASKS_MAX } from '@planar/shared';

/** Selector of elements of a task (rows, cards): `data-task-id` — the task uuid. */
export const TASK_SELECTOR = '[data-task-id]';
/** idle: how often the rendered tasks are offered for prefetch (ms) */
export const IDLE_SCAN_INTERVAL = 3000;

type Prefetch = (ids: Iterable<string>) => void;
interface IdleApi {
  requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
}

/**
 * Prefetch of task details (PLNRAPP-488): hovering an element `[data-task-id]` and, in idle time, the tasks
 * rendered on the page (≤ SYNC_TASKS_MAX) go to `prefetch` — batching and the rate limit are on its side
 * (client.prefetchTasks). Returns the uninstall.
 */
export function installTaskPrefetch(prefetch: Prefetch, root: Document = document): () => void {
  const onOver = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.(TASK_SELECTOR);
    const id = el?.getAttribute('data-task-id');
    if (id) prefetch([id]);
  };
  root.addEventListener('pointerover', onOver, { passive: true });

  const win = (root.defaultView ?? globalThis) as typeof globalThis & IdleApi;
  let idle: number | undefined;
  const scan = () => {
    idle = undefined;
    if (root.hidden) return;
    const ids = new Set<string>();
    for (const el of root.querySelectorAll(TASK_SELECTOR)) {
      const id = el.getAttribute('data-task-id');
      if (id) ids.add(id);
      if (ids.size >= SYNC_TASKS_MAX) break;
    }
    if (ids.size) prefetch(ids);
  };
  const timer = setInterval(() => {
    if (idle !== undefined) return;
    idle = win.requestIdleCallback
      ? win.requestIdleCallback(scan, { timeout: IDLE_SCAN_INTERVAL })
      : (setTimeout(scan, 0) as unknown as number);
  }, IDLE_SCAN_INTERVAL);

  return () => {
    root.removeEventListener('pointerover', onOver);
    clearInterval(timer);
    if (idle !== undefined)
      if (win.cancelIdleCallback) win.cancelIdleCallback(idle);
      else clearTimeout(idle);
  };
}
