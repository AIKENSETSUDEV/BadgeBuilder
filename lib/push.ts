import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import webpush from "web-push";

export const TEST_BADGE_COUNT = 5;

export type StoredPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

const subscriptionPath = path.join(process.cwd(), ".data", "subscription.json");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Restart the server after creating .env.local.`);
  }
  return value;
}

export function configureWebPush() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:badge-test@localhost",
    requireEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
    requireEnv("VAPID_PRIVATE_KEY")
  );
}

export async function saveSubscription(sub: StoredPushSubscription) {
  await mkdir(path.dirname(subscriptionPath), { recursive: true });
  await writeFile(subscriptionPath, JSON.stringify(sub, null, 2), "utf8");
}

export async function clearSubscription() {
  await writeFile(subscriptionPath, "", "utf8").catch(() => undefined);
  try {
    const { unlink } = await import("fs/promises");
    await unlink(subscriptionPath);
  } catch {
    // ignore missing file
  }
}

export async function loadSubscription(): Promise<StoredPushSubscription | null> {
  try {
    const raw = await readFile(subscriptionPath, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw) as StoredPushSubscription;
  } catch {
    return null;
  }
}

export async function sendBadgePush(badgeCount = TEST_BADGE_COUNT) {
  configureWebPush();
  const subscription = await loadSubscription();
  if (!subscription) {
    throw new Error("No push subscription saved. Enable background badge first.");
  }

  await webpush.sendNotification(
    subscription,
    JSON.stringify({
      title: "Badge Test",
      body: `Background badge set to ${badgeCount}`,
      unreadCount: badgeCount,
      icon: "/icon-192x192.png",
    })
  );
}
