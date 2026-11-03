import { readonly, ref, watch } from 'vue';
import { useRegisterSW } from './register';

export type UpdateState = 'idle' | 'checking' | 'current' | 'available' | 'error';
type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

// auto-check every 30 min and when the tab regains focus; if the tab is in background — apply at once,
// otherwise show the "Update" banner (do not reload in the middle of input)
const CHECK_MS = 30 * 60_000;

const updateState = ref<UpdateState>('idle');
const canInstall = ref(false);
const isStandalone = ref(false);
let isIos = false;
let reg: ServiceWorkerRegistration | undefined;
let sw: ReturnType<typeof useRegisterSW> | undefined;
let deferred: InstallEvent | undefined;

// downloading: the new worker is installing (precache); ready = needRefresh; applying: activation requested
const downloading = ref(false);
const applying = ref(false);

const check = () => void reg?.update().catch(() => {});

const FORCE_MS = 4000;

async function apply() {
  applying.value = true;
  // the reload itself is done by vite-plugin-pwa when the new worker takes control
  await sw!.updateServiceWorker(true);
  // Chromium leaves the skipWaiting'ed worker waiting when the page was loaded while it already waited (reproduced in
  // e2e/web/pwa-update.spec.ts): the click then did nothing. If the page is still here, drop the registration and
  // caches and reload — the next load installs the new version from the network.
  setTimeout(async () => {
    try {
      await reg?.unregister();
      for (const k of await caches.keys()) await caches.delete(k);
    } finally {
      location.reload();
    }
  }, FORCE_MS);
}

function init(): ReturnType<typeof useRegisterSW> {
  const s = useRegisterSW({
    onRegisteredSW(_url, r) {
      reg = r;
      if (!r) return;
      setInterval(check, CHECK_MS);
      r.addEventListener?.('updatefound', () => {
        const w = r.installing;
        // first install (no controller) is not an update
        if (!w || !navigator.serviceWorker?.controller) return;
        downloading.value = true;
        w.addEventListener('statechange', () => {
          if (w.state !== 'installing') downloading.value = false;
        });
      });
    },
  });
  const { needRefresh } = s;
  const applyIfHidden = () => {
    if (needRefresh.value && document.visibilityState === 'hidden') void apply();
  };
  watch(needRefresh, applyIfHidden);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
    else applyIfHidden();
  });

  const mq = window.matchMedia?.('(display-mode: standalone)');
  const nav = navigator as Navigator & { standalone?: boolean };
  isStandalone.value = !!mq?.matches || nav.standalone === true;
  mq?.addEventListener?.('change', (e) => {
    isStandalone.value = e.matches || nav.standalone === true;
    if (isStandalone.value) canInstall.value = false;
  });
  // iPadOS 13+ reports itself as a Mac, so we tell it apart by touch
  isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    canInstall.value = !isStandalone.value;
  });
  window.addEventListener('appinstalled', () => {
    deferred = undefined;
    canInstall.value = false;
  });
  return s;
}

async function checkForUpdates(): Promise<UpdateState> {
  if (!reg || !sw) return (updateState.value = 'error');
  updateState.value = 'checking';
  try {
    await reg.update();
    updateState.value = sw.needRefresh.value || reg.waiting ? 'available' : 'current';
  } catch {
    updateState.value = 'error';
  }
  return updateState.value;
}

async function install(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const ev = deferred;
  if (!ev) return 'unavailable';
  deferred = undefined;
  canInstall.value = false;
  try {
    await ev.prompt();
    return (await ev.userChoice).outcome;
  } catch {
    return 'unavailable';
  }
}

export function usePwa() {
  sw ??= init();
  const s = sw;
  return {
    needRefresh: s.needRefresh,
    updateState: readonly(updateState),
    checkForUpdates,
    downloading: readonly(downloading),
    applying: readonly(applying),
    applyUpdate: apply,
    canInstall: readonly(canInstall),
    isStandalone: readonly(isStandalone),
    isIos,
    install,
  };
}
