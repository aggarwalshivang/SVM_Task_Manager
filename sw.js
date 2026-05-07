const CACHE_NAME = 'svm-tasks-v3';

// Only cache truly static assets — NOT app.js (so API URL always loads fresh)
const ASSETS = [
  './index.html',
  './styles.css',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700;800&display=swap'
];

// Install: cache static assets and immediately take over
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  // Skip waiting so new SW activates immediately
  self.skipWaiting();
});

// Activate: delete all old caches and claim all open clients immediately
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(async () => {
      await self.clients.claim();
      // Removed forced reload to prevent "sudden loading" glitch
      // allClients.forEach((client) => client.navigate(client.url));
    })
  );
});

// Fetch Event
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never intercept API calls to Google Apps Script
  if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
    return;
  }

  // Always fetch app.js fresh from network (never from cache)
  if (url.pathname.endsWith('/app.js') || url.pathname.endsWith('/sw.js')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Only cache GET requests
  if (e.request.method !== 'GET') return;

  // Network first, fall back to cache
  e.respondWith(
    fetch(e.request).catch(async () => {
      const match = await caches.match(e.request);
      return match || new Response('Network error and no cache available', {
        status: 408,
        headers: { 'Content-Type': 'text/plain' }
      });
    })
  );
});
