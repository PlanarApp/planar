import { ref, watch } from 'vue';
import { api } from '../api/http';
import { clearLocal, syncState } from '../sync';
import { useAuth } from './useAuth';

/** http.ts and sync dispatch it on 423 locked */
export const LOCKED_EVENT = 'planar:locked';
const TICK = 1_000;
const BEAT = 60_000;
const MIN = 60_000;
/** seconds of the full-screen countdown before the idle lock */
export const COUNTDOWN = 10;

/** idle countdown (IdleCountdown.vue): seconds left; null — not running */
export const countdown = ref<number | null>(null);
let active = Date.now();
/** a click on the countdown: the user is here — no lock */
export function stillHere(): void {
  active = Date.now();
  countdown.value = null;
}

/** Lock now: the lock screen at once, the server session too (offline — only the screen). */
export async function lock(): Promise<void> {
  countdown.value = null;
  useAuth().locked.value = true;
  await api('POST', '/api/auth/lock').catch(() => {});
}

/**
 * App lock (user_security): «on every open» — the page load and a return to a tab hidden over a minute;
 * «on inactivity» — N minutes without input, then a 10-second countdown (a click cancels), then the lock;
 * a hidden tab locks without the countdown (nobody sees it). The server locks by itself after max(N, 3)
 * minutes without requests, so an active visible tab sends a heartbeat. Called once from main.ts.
 */
export function initLock(): void {
  const { user, ready, locked, lockPrefs } = useAuth();
  let hiddenAt = 0;
  let beat = 0;
  const on = () =>
    !!user.value && !locked.value && (lockPrefs.value.onOpen || lockPrefs.value.minutes !== null);

  for (const e of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
    window.addEventListener(
      e,
      () => {
        // input during the countdown is not «still here»: only a click on the countdown cancels it
        if (countdown.value === null) active = Date.now();
      },
      { capture: true, passive: true },
    );
  window.addEventListener(LOCKED_EVENT, () => {
    if (user.value) locked.value = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return void (hiddenAt = Date.now());
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    if (!on()) return;
    const m = lockPrefs.value.minutes;
    if ((lockPrefs.value.onOpen && away > MIN) || (m !== null && away > m * MIN)) void lock();
    else if (countdown.value === null) active = Date.now();
  });
  setInterval(() => {
    if (!on()) return void (countdown.value = null);
    const m = lockPrefs.value.minutes;
    const idle = Date.now() - active;
    if (m !== null && idle > m * MIN) {
      if (document.hidden) return void lock();
      const left = COUNTDOWN - Math.floor((idle - m * MIN) / 1000);
      if (left <= 0) return void lock();
      countdown.value = left;
      return;
    }
    if (!document.hidden && idle < Math.max(m ?? 0, 3) * MIN && Date.now() - beat > BEAT) {
      beat = Date.now();
      void api('GET', '/api/auth/me').catch(() => {});
    }
  }, TICK);

  // «on every open»: the page load of a signed-in user (not a fresh sign-in on this page)
  const stop = watch(
    ready,
    (r) => {
      if (!r) return;
      if (on() && lockPrefs.value.onOpen) void lock();
      queueMicrotask(() => stop());
    },
    { immediate: true },
  );

  // the replica is cleared on lock only when nothing is waiting to be sent
  watch(locked, (l) => {
    if (l && lockPrefs.value.wipe && syncState.value.pending === 0) void clearLocal();
  });
}
