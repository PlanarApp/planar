import { api } from '../api/http';

// Формат push-сообщения (шлюз Q5): JSON {title, body, url, tag, kind} — разбирается в public/push-sw.js.

export type PushResult = 'ok' | 'denied' | 'unsupported';

export const pushSupported = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** iOS в браузере (не установлено на экран Домой): push там недоступен. */
export function needsInstall(): boolean {
  // iPadOS 13+ представляется как Mac, но с тачем
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

const key = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

const registration = () => navigator.serviceWorker.ready;

export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  return !!(await (await registration()).pushManager.getSubscription());
}

export async function enablePush(): Promise<PushResult> {
  if (!pushSupported()) return 'unsupported';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const { publicKey } = await api<{ publicKey: string }>('GET', '/api/push/vapid');
  const sub = await (
    await registration()
  ).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(publicKey) });
  const { endpoint, keys } = sub.toJSON();
  await api('POST', '/api/push/subscribe', { endpoint, keys });
  return 'ok';
}

export async function disablePush(): Promise<void> {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await sub.unsubscribe();
  await api('DELETE', '/api/push/subscribe', { endpoint: sub.endpoint });
}
