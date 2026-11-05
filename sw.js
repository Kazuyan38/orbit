/* ORBIT — Service Worker: アプリ本体をキャッシュしてオフラインで起動できるようにする。
   データは localStorage にあり、ここでは扱わない。更新時は VERSION を上げる。 */
const VERSION = 'orbit-v1.0.0';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './js/core.js', './js/ui.js', './js/store.js', './js/sapphire.js', './js/todo.js', './js/projects.js',
  './js/focus.js', './js/modules.js', './js/schedule.js', './js/memo.js', './js/account.js', './js/push.js', './js/app.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Web Push: 集中・休憩の終了と毎朝の要約。サーバー（supabase/functions/orbit-push）から届く。
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { /* 本文なしの通知 */ }
  e.waitUntil(self.registration.showNotification(d.title || 'ORBIT', {
    body: d.body || '', tag: d.tag || 'orbit', icon: './icons/icon-192.png', badge: './icons/icon-192.png', renotify: true,
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => 'focus' in c);
    return open ? open.focus() : self.clients.openWindow('./');
  }));
});

// ネットワーク優先（更新をすぐ反映）、つながらなければキャッシュ。
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
  );
});
