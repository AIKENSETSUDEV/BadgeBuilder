"use server";

import {
  clearSubscription,
  saveSubscription,
  sendBadgePush,
  TEST_BADGE_COUNT,
  type StoredPushSubscription,
} from "@/lib/push";

export async function subscribeUser(sub: StoredPushSubscription) {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return { ok: false as const, error: "Invalid subscription" };
  }
  await saveSubscription(sub);
  return { ok: true as const };
}

export async function unsubscribeUser() {
  await clearSubscription();
  return { ok: true as const };
}

export async function sendBackgroundBadge(count = TEST_BADGE_COUNT) {
  try {
    await sendBadgePush(count);
    return { ok: true as const, count };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Failed to send push",
    };
  }
}

/** Schedules a push after delay so you can close/minimize the app first. */
export async function scheduleBackgroundBadge(
  delayMs = 10_000,
  count = TEST_BADGE_COUNT
) {
  const subscriptionOk = await import("@/lib/push").then((m) =>
    m.loadSubscription()
  );
  if (!subscriptionOk) {
    return {
      ok: false as const,
      error: "No push subscription saved. Enable background badge first.",
    };
  }

  setTimeout(() => {
    void sendBadgePush(count).catch((err) => {
      console.error("Scheduled badge push failed:", err);
    });
  }, delayMs);

  return { ok: true as const, delayMs, count };
}
