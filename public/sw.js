/* DJ/VJ Studio service worker: static assets only.
 * - Navigations always reach the server for access-code verification.
 * - Static assets (/_next/static, icons, fonts): cache first (immutable, hashed URLs).
 * Audio lives in IndexedDB, so nothing large is cached here.
 */
const VERSION = "djvj-v2-auth";
const SHELL = ["/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg", "/keylock-worklet.js", "/scratch-worklet.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("djvj-") && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() => new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>接続を確認してください</title><body style="background:#09090b;color:#e4e4e7;font:16px system-ui;padding:40px"><h1>接続を確認してください</h1><p>ログインの確認にはインターネット接続が必要です。</p><a style="color:#22d3ee" href="/">もう一度開く</a></body></html>', { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } })),
    );
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/keylock-worklet.js" || url.pathname === "/scratch-worklet.js" || /\.(svg|png|ico|woff2?|webmanifest)$/.test(url.pathname)) {
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
