/* Service worker: sets app icon badge from Push even when the PWA is closed.
 *
 * Platform notes (Windows):
 * - Microsoft Edge: closed-app / taskbar badges ARE supported.
 * - Google Chrome: setAppBadge from SW runs, but Chrome does not paint the
 *   badge while the PWA window is fully closed (Chromium limitation).
 */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

async function applyBadge(unreadCount) {
  const nav = self.navigator || navigator;
  if (!nav || typeof nav.setAppBadge !== "function") {
    return { ok: false, reason: "setAppBadge missing in SW" };
  }

  try {
    if (unreadCount > 0) {
      await nav.setAppBadge(unreadCount);
    } else if (typeof nav.clearAppBadge === "function") {
      await nav.clearAppBadge();
    }
    return { ok: true, reason: `setAppBadge(${unreadCount}) resolved` };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "setAppBadge rejected",
    };
  }
}

async function handlePush(event) {
  let payload = {
    title: "Badge Test",
    body: "Background badge updated",
    unreadCount: 5,
    icon: "/icon-192x192.png",
  };

  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    // keep defaults
  }

  const unreadCount =
    typeof payload.unreadCount === "number" ? payload.unreadCount : 5;

  const badgeResult = await applyBadge(unreadCount);
  const clientCount = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).length;

  // Include diagnostics in the toast so you can tell API success vs OS paint.
  await self.registration.showNotification(payload.title || "Badge Test", {
    body: [
      payload.body || `Badge target ${unreadCount}`,
      badgeResult.reason,
      `openWindows=${clientCount}`,
      clientCount === 0
        ? "If using Chrome on Windows, closed-app badges are not painted — use Edge."
        : "Window still open: badge should show on Chrome and Edge.",
    ].join(" · "),
    icon: payload.icon || "/icon-192x192.png",
    badge: "/icon-192x192.png",
    data: { url: "/", unreadCount, badgeResult },
    tag: "badge-test",
    renotify: true,
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
