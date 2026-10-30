import { readonly, ref, watch } from 'vue';
import { useRegisterSW } from './register';

export type UpdateState = 'idle' | 'checking' | 'current' | 'available' | 'error';
type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

// автопроверка раз в 30 мин и при возврате во вкладку; вкладка в фоне — применяем сразу,
// иначе плашка «Обновить» (не перезагружать посреди ввода)
const CHECK_MS = 30 * 60_000;

const updateState = ref<UpdateState>('idle');
const canInstall = ref(false);
const isStandalone = ref(false);
let isIos = false;
let reg: ServiceWorkerRegistration | undefined;
let sw: ReturnType<typeof useRegisterSW> | undefined;
let deferred: InstallEvent | undefined;

const check = () => void reg?.update().catch(() => {});

function init(): ReturnType<typeof useRegisterSW> {
  const s = useRegisterSW({
    onRegisteredSW(_url, r) {
      reg = r;
      if (r) setInterval(check, CHECK_MS);
    },
  });
  const { needRefresh, updateServiceWorker } = s;
  const applyIfHidden = () => {
    if (needRefresh.value && document.visibilityState === 'hidden') void updateServiceWorker(true);
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
  // iPadOS 13+ выдаёт себя за Mac, отличаем по тачу
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
    applyUpdate: () => s.updateServiceWorker(true),
    canInstall: readonly(canInstall),
    isStandalone: readonly(isStandalone),
    isIos,
    install,
  };
}
