import webpush from "web-push";

export const TEST_BADGE_COUNT = 5;

export type StoredPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name && error.name !== "Error" ? `${error.name}: ` : "";
    return `${name}${error.message}`;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. On Vercel: Project → Settings → Environment Variables → add it → Redeploy.`
    );
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

export function assertSubscription(
  sub: StoredPushSubscription | null | undefined
): StoredPushSubscription {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    throw new Error(
      "Invalid or missing push subscription. Tap “Enable notifications” first."
    );
  }
  return sub;
}

export async function sendBadgePush(
  badgeCount: number,
  subscription: StoredPushSubscription
) {
  configureWebPush();
  const sub = assertSubscription(subscription);

  await webpush.sendNotification(
    sub,
    JSON.stringify({
      title: "Badge Test",
      body: `Unread notification (badge target ${badgeCount})`,
      unreadCount: badgeCount,
      icon: "/icon-192x192.png",
    })
  );
}
