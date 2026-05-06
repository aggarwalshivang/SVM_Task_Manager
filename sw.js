const CACHE_NAME = 'svm-tasks-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700;800&display=swap'
];

// Install Event
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Activate Event
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
});

// Fetch Event
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  // Skip interception for API calls (Apps Script)
  if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
    return;
  }

  // Only cache GET requests for local assets
  if (e.request.method !== 'GET') return;
  
  // Network first, then cache
  e.respondWith(
    fetch(e.request).catch(async () => {
      const match = await caches.match(e.request);
      if (match) return match;
      // If no cache, return a basic error response or just let it fail
      return new Response('Network error and no cache available', {
        status: 408,
        headers: { 'Content-Type': 'text/plain' }
      });
    })
  );
});
