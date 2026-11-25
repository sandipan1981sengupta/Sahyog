/*
 * ShankhNaad · service worker.
 *
 * Its job is to make the site installable as a desktop app (Chrome / Edge).
 * It does NOT cache pages, scripts or API calls, so people always see live data
 * and never a stale or signed-out copy of a page. When the server is slow to wake up,
 * it shows a small "Connecting…" screen instead of a blank window.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// ---- "Connecting…" while the server wakes up ----
// After a long quiet time the hosting stops the app; the first page can then take several seconds.
// If a page hasn't answered in 2.5 s, the window shows a small "Connecting…" screen (made here, nothing is cached)
// that waits for /health and then loads the page again, instead of a blank window.
const SLOW_MS = 2500;
const waitedFor = new Map();
self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.mode !== "navigate" || req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin || url.pathname.startsWith("/health")) return;
    // just showed "Connecting…" for this page? then the server is awake: wait for the page itself,
    // so a page that is simply slow can never loop back to the waiting screen
    const shownAt = waitedFor.get(req.url);
    if (shownAt && Date.now() - shownAt < 120000) { waitedFor.delete(req.url); return; }
    event.respondWith((async () => {
        const live = fetch(req);
        const slow = new Promise((resolve) => setTimeout(() => resolve(null), SLOW_MS));
        try {
            const first = await Promise.race([live, slow]);
            if (first) return first;
        } catch (e) { /* no network: fall through to the waiting screen */ }
        waitedFor.set(req.url, Date.now());
        return new Response(connectingPage(), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    })());
});

function connectingPage() {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ShankhNaad · Connecting…</title>
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body { display: grid; place-items: center; font: 500 15px/1.5 Roboto, "Segoe UI", system-ui, sans-serif;
         background: radial-gradient(circle at 20% 15%, rgba(249,115,22,.18), transparent 45%), radial-gradient(circle at 85% 85%, rgba(22,163,74,.16), transparent 45%), #F8FAFC; color: #0F172A; }
  @media (prefers-color-scheme: dark) { body { background: radial-gradient(circle at 20% 15%, rgba(99,102,241,.25), transparent 45%), radial-gradient(circle at 85% 85%, rgba(236,72,153,.2), transparent 45%), #0B1020; color: #E2E8F0; } }
  .box { display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; padding: 24px; }
  .logo { width: 64px; height: 64px; border-radius: 18px; background: linear-gradient(135deg, #F97316, #16A34A); display: grid; place-items: center; color: #fff; font: 800 26px Roboto, sans-serif; box-shadow: 0 12px 30px -12px rgba(0,0,0,.45); }
  .ring { width: 28px; height: 28px; border-radius: 50%; border: 3px solid rgba(127,127,127,.25); border-top-color: #F97316; animation: spin .9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .ring { animation-duration: 3s; } }
  b { font-size: 18px; letter-spacing: .04em; }
  small { opacity: .7; max-width: 320px; }
  button { margin-top: 4px; height: 38px; padding: 0 18px; border-radius: 999px; border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; font: inherit; cursor: pointer; }
</style></head><body>
<div class="box" role="status" aria-live="polite">
  <div class="logo" aria-hidden="true">S</div>
  <b>SHANKHNAAD</b>
  <div class="ring" aria-hidden="true"></div>
  <span id="msg">Connecting…</span>
  <small id="sub">The server was resting. This takes a few seconds the first time.</small>
  <button type="button" onclick="location.reload()">Try again</button>
</div>
<script>
  var tries = 0;
  function check() {
    tries++;
    fetch("/health", { cache: "no-store" }).then(function (r) {
      if (r.ok) { location.reload(); return; }
      wait("Starting the database…");
    }).catch(function () { wait(navigator.onLine ? "Still connecting…" : "No internet connection. Waiting for it…"); });
  }
  function wait(text) {
    document.getElementById("msg").textContent = text;
    if (tries > 20) document.getElementById("sub").textContent = "This is taking longer than usual. Check your internet, or press Try again.";
    setTimeout(check, 2000);
  }
  window.addEventListener("online", check);
  check();
</script></body></html>`;
}

// Clicking a desktop notification (e.g. an incoming call) brings the app window to the front.
self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || "/";
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of windows) {
            if ("focus" in client) {
                await client.focus();
                if (url !== "/" && "navigate" in client) await client.navigate(url);
                return;
            }
        }
        if (self.clients.openWindow) await self.clients.openWindow(url);
    })());
});
