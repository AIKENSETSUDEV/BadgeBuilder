/* Service worker: push → notification (+ setAppBadge where supported).
 *
 * Android Chrome: Badging API is NOT used. An unread notification creates
 * the home-screen badge automatically while the PWA is closed.
 * Edge Windows: setAppBadge can show a numeric taskbar badge when closed.
 * Chrome Windows: setAppBadge only paints while the PWA window is open.
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
    return { ok: false, reason: "setAppBadge N/A (expected on Android Chrome)" };
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
    body: "Background update",
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
  const clientCount = (
    await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  ).length;

  await self.registration.showNotification(payload.title || "Badge Test", {
    body: [
      payload.body || `Unread count ${unreadCount}`,
      badgeResult.reason,
      `windows=${clientCount}`,
      "Android: leave this notification unread to see the app-icon badge.",
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
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      })
  );
});
