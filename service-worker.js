const CACHE = "wonder-plan-v13-2";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./map/vendor/leaflet.js",
  "./map/vendor/leaflet.css",
  "./map/journey-map.css",
  "./map/journey-map.js",
  "./booking/scan.js",
  "./booking/editor.js",
  "./booking/editor.css",
  "./map/journey-data.js",
  "./map/boundaries.json",
  "./map/places.json",
  "./map/terrain.webp",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(path => new Request(path, {cache: "reload"}))))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith("wonder-plan-") && k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

async function loadPage(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(request, {cache: "no-cache", signal: controller.signal});
    if (response.ok) return response;
  } catch {
    // The versioned app shell is available when the connection fails.
  } finally {
    clearTimeout(timeout);
  }
  const cache = await caches.open(CACHE);
  return (await cache.match("./index.html")) || Response.error();
}

self.addEventListener("fetch", event => {
  const {request} = event;
  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    event.respondWith(loadPage(request));
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin && url.hostname !== "images.unsplash.com") return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      try { await cache.put(request, response.clone()); } catch {}
    }
    return response;
  })());
});
