const CACHE_NAME = 'juncao-cargas-v2'; // ⚠️ incremente a versão a cada deploy novo
const urlsToCache = [
    './',
    './index.html',
    './app.js',
    './styles.css',
    './manifest.json',
    './libs/tailwind.min.js',
    './libs/html5-qrcode.min.js',
    './libs/xlsx.full.min.js',
    './libs/filesaver.min.js',
    './assets/logo.png',
    './icon-192.png',
    './icon-512.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
            .then(() => self.skipWaiting())
            .catch(err => console.error('Falha ao cachear arquivos:', err))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(nomes =>
            Promise.all(
                nomes.filter(nome => nome !== CACHE_NAME)
                     .map(nome => caches.delete(nome))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            if (response) return response;
            return fetch(event.request).catch(() => {
                // fallback simples se estiver offline e recurso não estiver no cache
                return new Response('Offline - recurso não disponível em cache', {
                    status: 503,
                    statusText: 'Offline'
                });
            });
        })
    );
});
