import { watch } from 'vue';
import { api } from '../api/http';
import { clearLocal, syncState } from '../sync';
import { useAuth } from './useAuth';

/** http.ts and sync dispatch it on 423 locked */
export const LOCKED_EVENT = 'planar:locked';
const TICK = 15_000;
const BEAT = 60_000;
const MIN = 60_000;

/**
 * App lock (user_security.lockMinutes): on every open (0) or after N minutes without input; a tab hidden
 * longer than that locks on return. The server locks by itself after max(N, 3) minutes without requests,
 * so an active visible tab sends a heartbeat. Called once from main.ts.
 */
/** Lock now: the lock screen at once, the server session too (offline — only the screen). */
export async function lock(): Promise<void> {
  useAuth().locked.value = true;
  await api('POST', '/api/auth/lock').catch(() => {});
}

export function initLock(): void {
  const { user, ready, locked, lockPrefs } = useAuth();
  let active = Date.now();
  let hiddenAt = 0;
  let beat = 0;
  const on = () => !!user.value && !locked.value && lockPrefs.value.minutes !== null;

  for (const e of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
    window.addEventListener(e, () => (active = Date.now()), { capture: true, passive: true });
  window.addEventListener(LOCKED_EVENT, () => {
    if (user.value) locked.value = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return void (hiddenAt = Date.now());
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    active = Date.now();
    if (on() && away > Math.max(lockPrefs.value.minutes!, 1) * MIN) void lock();
  });
  setInterval(() => {
    if (!on() || document.hidden) return;
    const m = lockPrefs.value.minutes!;
    const idle = Date.now() - active;
    if (m > 0 && idle > m * MIN) return void lock();
    if (idle < Math.max(m, 3) * MIN && Date.now() - beat > BEAT) {
      beat = Date.now();
      void api('GET', '/api/auth/me').catch(() => {});
    }
  }, TICK);

  // «on every open»: the page load of a signed-in user (not a fresh sign-in on this page)
  const stop = watch(
    ready,
    (r) => {
      if (!r) return;
      if (on() && lockPrefs.value.minutes === 0) void lock();
      queueMicrotask(() => stop());
    },
    { immediate: true },
  );

  // the replica is cleared on lock only when nothing is waiting to be sent
  watch(locked, (l) => {
    if (l && lockPrefs.value.wipe && syncState.value.pending === 0) void clearLocal();
  });
}
