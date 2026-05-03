// sw.js — Service Worker
const CACHE_NAME = 'secret-chat-v2';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => caches.match('/index.html'))
  );
});

// ── Push received ──
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try { payload = event.data.json(); }
  catch(e) { payload = { sender: 'Message', content: event.data.text() }; }

  event.waitUntil(
    // Check if app is open AND visible (not just open in background)
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const appIsVisible = list.some(c => !c.hidden && c.visibilityState !== 'hidden');

      // If app is open and the user is actively looking at it → skip notification
      if (appIsVisible) return;

      // Otherwise show the notification
      return self.registration.showNotification(payload.sender || 'New message', {
        body: payload.content || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        vibrate: [100, 50, 100],
        tag: 'chat-' + (payload.room_id || 'msg'),
        renotify: true,
        requireInteraction: false,
        silent: false,
        data: {
          url: self.registration.scope,
          sender: payload.sender,
          room: payload.room_id
        },
        actions: [{ action: 'open', title: 'Open' }]
      });
    })
  );
});

// ── Notification click ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── App tells SW when it's focused/unfocused ──
self.addEventListener('message', event => {
  if (event.data?.type === 'APP_FOCUSED') {
    self.appFocused = event.data.focused;
  }
});

self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: event.oldSubscription?.options?.applicationServerKey
    })
  );
});