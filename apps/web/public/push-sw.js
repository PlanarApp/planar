// Подключается в workbox через importScripts. Формат — C-http «Web Push» (pushPayloadSchema в @planar/shared):
// {title, body, url, tag, kind}. Правила ниже должны совпадать со схемой (проверяет inbox:push-format).
const KINDS = ['assigned', 'mentioned', 'commented', 'status_changed'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function valid(m) {
  return (
    !!m &&
    typeof m === 'object' &&
    typeof m.title === 'string' &&
    m.title.length > 0 &&
    typeof m.body === 'string' &&
    typeof m.url === 'string' &&
    m.url.startsWith('/') &&
    !m.url.startsWith('//') &&
    typeof m.tag === 'string' &&
    UUID.test(m.tag) &&
    KINDS.includes(m.kind)
  );
}

self.addEventListener('push', (e) => {
  let m;
  try {
    m = e.data ? e.data.json() : undefined;
  } catch {
    /* не JSON */
  }
  if (!valid(m)) {
    console.warn('push: сообщение не по схеме C-http, не показано');
    return;
  }
  e.waitUntil(
    self.registration.showNotification(m.title, {
      body: m.body,
      tag: m.tag,
      data: { url: m.url },
      icon: '/icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const raw = e.notification.data && e.notification.data.url;
  const origin = self.location.origin;
  let target;
  try {
    target = new URL(typeof raw === 'string' ? raw : '/', origin);
  } catch {
    target = new URL('/', origin);
  }
  // только свой origin; иначе — на корень приложения
  const url = target.origin === origin ? target.href : origin + '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
      const w = ws[0];
      if (w) return w.focus().then((c) => ('navigate' in c ? c.navigate(url) : c));
      return self.clients.openWindow(url);
    }),
  );
});
