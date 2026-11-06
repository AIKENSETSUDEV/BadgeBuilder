"use server";

import { after } from "next/server";
import {
  assertSubscription,
  formatError,
  sendBadgePush,
  TEST_BADGE_COUNT,
  type StoredPushSubscription,
} from "@/lib/push";

export async function sendBackgroundBadge(
  subscription: StoredPushSubscription,
  count = TEST_BADGE_COUNT
) {
  try {
    await sendBadgePush(count, subscription);
    return { ok: true as const, count };
  } catch (error) {
    return { ok: false as const, error: formatError(error) };
  }
}

/**
 * Schedules a push after delayMs using Next.js `after()` so it can still fire
 * on Vercel after the client closes the PWA (unlike a client setTimeout).
 */
export async function scheduleBackgroundBadge(
  subscription: StoredPushSubscription,
  delayMs = 10_000,
  count = TEST_BADGE_COUNT
) {
  try {
    const sub = assertSubscription(subscription);

    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        await sendBadgePush(count, sub);
      } catch (error) {
        console.error("Scheduled badge push failed:", formatError(error));
      }
    });

    return { ok: true as const, delayMs, count };
  } catch (error) {
    return { ok: false as const, error: formatError(error) };
  }
}

export async function checkPushEnv() {
  return {
    hasPublicKey: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    hasPrivateKey: Boolean(process.env.VAPID_PRIVATE_KEY),
  };
}
