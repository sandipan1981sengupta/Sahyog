/*
 * ShankhNaad · service worker.
 *
 * Its job is to make the site installable as a desktop app (Chrome / Edge).
 * It does NOT cache pages, scripts or API calls, so people always see live data
 * and never a stale or signed-out copy of a page.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
