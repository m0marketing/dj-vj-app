/* DJ/VJ Studio service worker: offline app shell.
 * - Navigations: network first, fall back to the cached shell.
 * - Static assets (/_next/static, icons, fonts): cache first (immutable, hashed URLs).
 * Audio lives in IndexedDB, so nothing large is cached here.
 */
const VERSION = "djvj-v1";
const SHELL = ["/", "/vj", "/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg", "/keylock-worklet.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(url.pathname === "/vj" ? "/vj" : "/", copy));
          return res;
        })
        .catch(() => caches.match(url.pathname === "/vj" ? "/vj" : "/")),
    );
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/keylock-worklet.js" || /\.(svg|png|ico|woff2?|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
  }
});
