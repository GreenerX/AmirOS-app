// Installation helper only: do not add an app shell or Cache API here.
// AmirOS must always load the current local dashboard after an update.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
