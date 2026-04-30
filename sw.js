// sw.js — Service Worker
// Tourne en arrière-plan, reçoit les push même téléphone verrouillé

const CACHE_NAME = 'secret-chat-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

// ── Installation ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── Activation ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch (cache first pour les assets) ──
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        // Mettre en cache les nouvelles ressources
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => caches.match('/index.html'))
  );
});

// ── Réception d'un push ──
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch(e) {
    payload = { title: 'Nouveau message', body: event.data.text() };
  }

  const title = payload.sender || 'Message';
  const options = {
    body: payload.content || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    vibrate: [100, 50, 100],
    tag: 'chat-message',          // regrouper les notifs du même salon
    renotify: true,               // faire vibrer même si tag identique
    requireInteraction: false,    // disparaît automatiquement sur Android
    silent: false,
    data: {
      url: self.registration.scope,
      sender: payload.sender,
      room: payload.room_id
    },
    // Actions rapides (Android Chrome uniquement)
    actions: [
      { action: 'reply', title: 'Ouvrir' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── Clic sur la notification ──
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Si l'app est déjà ouverte → la mettre au premier plan
      for (const client of list) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Sinon → ouvrir une nouvelle fenêtre
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// ── Push subscription change (renouvellement automatique) ──
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: event.oldSubscription?.options?.applicationServerKey
    }).then(sub => {
      // Notifier le serveur du nouveau sub
      return fetch('/api/update-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() })
      });
    })
  );
});