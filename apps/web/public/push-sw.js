// Подключается в workbox через importScripts. Формат: {title, body, url, tag, kind}
self.addEventListener('push', (e) => {
  let m = {};
  try {
    m = e.data ? e.data.json() : {};
  } catch {
    /* не JSON — показываем пустое уведомление ниже */
  }
  e.waitUntil(
    self.registration.showNotification(m.title || 'Planar', {
      body: m.body,
      tag: m.tag,
      data: { url: m.url || '/' },
      icon: '/icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
      const w = ws[0];
      if (w) return w.focus().then((c) => ('navigate' in c ? c.navigate(url) : c));
      return self.clients.openWindow(url);
    }),
  );
});
