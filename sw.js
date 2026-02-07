self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('v1').then((cache) => {
      return fetch('/manifest.json')
        .then(() => cache.addAll([
          '/',
          '/index.html',
          '/styles.css',
          '/script.js'
        ]))
        .catch(() => {
          console.log('Some files failed to cache');
        });
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});