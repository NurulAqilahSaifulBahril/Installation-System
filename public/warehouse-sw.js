// Service worker for the Inventory Management app (installed from /warehouse).
//
// It keeps no copy of any data: stock, jobs, customers and photos always come live from the
// server, and API calls are never touched. Its only job is the installable app shell: when the
// phone is offline, opening the app shows a short "You're offline" page instead of the browser's
// error page. Served with no-cache headers (next.config.ts), so a new version is picked up at once.

const OFFLINE_CACHE = "inventory-offline-v1";
const OFFLINE_URL = "/warehouse-offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, "/warehouse-icons/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== OFFLINE_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Page loads only: try the network; if it cannot be reached, show the offline page.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL).then((page) => page || Response.error())),
  );
});
