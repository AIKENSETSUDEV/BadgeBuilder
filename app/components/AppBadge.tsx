"use client";

import { useEffect, useMemo, useState } from "react";
import {
  checkPushEnv,
  scheduleBackgroundBadge,
  sendBackgroundBadge,
} from "@/app/actions";

const TEST_BADGE_COUNT = 5;
const PUBLIC_VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const SUB_STORAGE_KEY = "badge-test-push-subscription";

type Status = "idle" | "needs-enable" | "ready" | "unsupported" | "error";

type Platform = "android" | "ios" | "desktop";
type BrowserKind = "edge" | "chrome" | "safari" | "samsung" | "firefox" | "other";

type StoredPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

declare global {
  interface Navigator {
    setAppBadge?: (contents?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  }
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  return "desktop";
}

function detectBrowser(): BrowserKind {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "edge";
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\//.test(ua) || /CriOS\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

function formatClientError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name && error.name !== "Error" ? `${error.name}: ` : "";
    return `${name}${error.message}`;
  }
  return String(error);
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

function serializeSubscription(sub: PushSubscription): StoredPushSubscription {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Push subscription is missing endpoint/keys.");
  }
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
}

function loadStoredSubscription(): StoredPushSubscription | null {
  try {
    const raw = localStorage.getItem(SUB_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredPushSubscription;
  } catch {
    return null;
  }
}

function persistSubscription(sub: StoredPushSubscription | null) {
  if (!sub) {
    localStorage.removeItem(SUB_STORAGE_KEY);
    return;
  }
  localStorage.setItem(SUB_STORAGE_KEY, JSON.stringify(sub));
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported in this browser.");
  }
  return navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
}

export function AppBadge() {
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState("Checking device…");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [swReady, setSwReady] = useState(false);
  const [subscription, setSubscription] = useState<StoredPushSubscription | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [browser, setBrowser] = useState<BrowserKind>("other");
  const [standalone, setStandalone] = useState(false);
  const [badgeApi, setBadgeApi] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "default"
  );
  const [envInfo, setEnvInfo] = useState<{
    hasPublicKey: boolean;
    hasPrivateKey: boolean;
  } | null>(null);
  const [ua, setUa] = useState("");

  const canSend = Boolean(subscription) && status === "ready" && !busy;

  const guidance = useMemo(() => {
    if (platform === "android") {
      return {
        tone: "ok" as const,
        title: `Android · ${browser}`,
        body: "setAppBadge is not used on Android Chrome. Closed-app badges come from an unread push notification (usually a dot). Enable notifications, send a test push, close the PWA, leave the notification unread.",
      };
    }
    if (platform === "ios") {
      return {
        tone: "ok" as const,
        title: `iOS · ${browser}`,
        body: "Install to Home Screen and allow notifications. Badges need notification permission on iOS.",
      };
    }
    if (browser === "chrome") {
      return {
        tone: "warn" as const,
        title: "Desktop Chrome",
        body: "Closed-app numeric badges are not painted on Windows Chrome. Use Edge for closed taskbar badges, or minimize (keep window alive) on Chrome.",
      };
    }
    if (browser === "edge") {
      return {
        tone: "ok" as const,
        title: "Desktop Edge",
        body: "Closed-app taskbar badges via setAppBadge are supported. Install as PWA, enable notifications, delay-send, then close the app.",
      };
    }
    return {
      tone: "warn" as const,
      title: `${platform} · ${browser}`,
      body: "Push + notification is the portable path. Numeric Badging API support varies by OS/browser.",
    };
  }, [platform, browser]);

  useEffect(() => {
    const nextPlatform = detectPlatform();
    const nextBrowser = detectBrowser();
    setPlatform(nextPlatform);
    setBrowser(nextBrowser);
    setUa(navigator.userAgent);
    setBadgeApi(typeof navigator.setAppBadge === "function");
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    );
    setPermission(
      "Notification" in window ? Notification.permission : "unsupported"
    );

    const cached = loadStoredSubscription();
    if (cached) setSubscription(cached);

    let cancelled = false;

    async function bootstrap() {
      try {
        const env = await checkPushEnv();
        if (cancelled) return;
        setEnvInfo(env);

        if (!PUBLIC_VAPID_KEY || !env.hasPublicKey || !env.hasPrivateKey) {
          setStatus("error");
          setErrorText(
            [
              !PUBLIC_VAPID_KEY || !env.hasPublicKey
                ? "Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY in this deployment."
                : null,
              !env.hasPrivateKey
                ? "Missing VAPID_PRIVATE_KEY in this deployment."
                : null,
              "Add both in Vercel → Project → Settings → Environment Variables, then Redeploy.",
            ]
              .filter(Boolean)
              .join(" ")
          );
          setDetail("Push environment is incomplete.");
          return;
        }

        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
          setStatus("unsupported");
          setDetail("This browser does not support service workers + PushManager.");
          return;
        }

        const registration = await registerServiceWorker();
        if (cancelled) return;
        setSwReady(Boolean(registration));
        await navigator.serviceWorker.ready;

        // Do NOT auto-request permission here — Android requires a user gesture.
        setStatus("needs-enable");
        setDetail(
          cached
            ? "Service worker ready. Tap Enable to refresh permission/subscription (required on Android)."
            : "Service worker ready. Tap Enable notifications to subscribe (must be a tap on Android)."
        );
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorText(formatClientError(err));
        setDetail("Bootstrap failed.");
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onEnable() {
    setBusy(true);
    setErrorText(null);
    setLastAction(null);
    try {
      if (!PUBLIC_VAPID_KEY) {
        throw new Error("NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing in the client bundle.");
      }
      if (!("Notification" in window)) {
        throw new Error("Notifications API is not available.");
      }

      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        setStatus("needs-enable");
        setDetail("Notification permission was not granted.");
        setErrorText(
          `Notification.permission=${nextPermission}. On Android Chrome, allow notifications for this site/app, then tap Enable again.`
        );
        return;
      }

      const registration =
        (await navigator.serviceWorker.getRegistration()) ??
        (await registerServiceWorker());
      await navigator.serviceWorker.ready;
      setSwReady(true);

      const existing = await registration.pushManager.getSubscription();
      let pushSub: PushSubscription;
      try {
        pushSub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY),
        });
      } catch (subscribeError) {
        // Common when VAPID keys rotated — drop old subscription and retry once.
        if (existing) await existing.unsubscribe().catch(() => undefined);
        try {
          pushSub = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY),
          });
        } catch (retryError) {
          throw new Error(
            `Push subscribe failed: ${formatClientError(retryError)} (first: ${formatClientError(subscribeError)})`
          );
        }
      }

      const serialized = serializeSubscription(pushSub);
      persistSubscription(serialized);
      setSubscription(serialized);
      setStatus("ready");
      setDetail(
        platform === "android"
          ? "Subscribed. Use Send now / Send in 10s, then close the PWA and leave the notification unread."
          : "Subscribed. Use the send buttons to test background badge/notification."
      );
      setLastAction("Notifications enabled and push subscription saved on this device.");
    } catch (err) {
      setStatus("error");
      setErrorText(formatClientError(err));
      setDetail("Enable failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onSendNow() {
    if (!subscription) {
      setErrorText("No subscription yet. Tap Enable notifications first.");
      return;
    }
    setBusy(true);
    setErrorText(null);
    setLastAction(null);
    const result = await sendBackgroundBadge(subscription, TEST_BADGE_COUNT);
    setBusy(false);
    if (!result.ok) {
      setErrorText(result.error);
      setLastAction(null);
      return;
    }
    setLastAction(
      platform === "android"
        ? `Push sent. Close the PWA and leave the notification unread — Android should show an icon badge.`
        : `Push sent (badge target ${result.count}). Check notification diagnostics.`
    );
  }

  async function onSendDelayed() {
    if (!subscription) {
      setErrorText("No subscription yet. Tap Enable notifications first.");
      return;
    }
    setBusy(true);
    setErrorText(null);
    setLastAction(null);
    const result = await scheduleBackgroundBadge(
      subscription,
      10_000,
      TEST_BADGE_COUNT
    );
    setBusy(false);
    if (!result.ok) {
      setErrorText(result.error);
      return;
    }
    setLastAction(
      platform === "android"
        ? `Scheduled in ${result.delayMs / 1000}s. Close the installed PWA now. When the notification arrives, leave it unread to see the home-screen badge.`
        : `Scheduled in ${result.delayMs / 1000}s. Close/minimize the installed app now.`
    );
  }

  async function onSetForeground() {
    setBusy(true);
    setErrorText(null);
    setLastAction(null);
    try {
      if (!navigator.setAppBadge) {
        setErrorText(
          "setAppBadge is not available (normal on Android Chrome — use push notification badge instead)."
        );
        return;
      }
      await navigator.setAppBadge(TEST_BADGE_COUNT);
      setLastAction(`Foreground setAppBadge(${TEST_BADGE_COUNT}) OK.`);
    } catch (err) {
      setErrorText(formatClientError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDisable() {
    setBusy(true);
    setErrorText(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const sub = await registration?.pushManager.getSubscription();
      await sub?.unsubscribe();
      persistSubscription(null);
      setSubscription(null);
      if (navigator.clearAppBadge) await navigator.clearAppBadge();
      setStatus("needs-enable");
      setDetail("Push disabled on this device. Tap Enable to subscribe again.");
      setLastAction("Unsubscribed and cleared local subscription.");
    } catch (err) {
      setErrorText(formatClientError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 text-left shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Background app badge
        </h2>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Test push → notification → icon badge. Android uses unread notifications;
          desktop Edge can use numeric Badging API.
        </p>
      </div>

      <div
        className={`rounded-xl px-3 py-3 text-sm leading-6 ${
          guidance.tone === "warn"
            ? "bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
            : "bg-sky-50 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100"
        }`}
      >
        <p className="font-medium">{guidance.title}</p>
        <p className="mt-1">{guidance.body}</p>
      </div>

      {errorText ? (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-3 text-sm leading-6 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100">
          <p className="font-semibold">Error</p>
          <p className="mt-1 break-words font-mono text-[0.85em]">{errorText}</p>
        </div>
      ) : null}

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Platform / browser</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">
            {platform} / {browser}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Standalone PWA</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">
            {standalone ? "yes" : "no"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Notification permission</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">{permission}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Service worker</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">
            {swReady ? "registered" : "pending"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Push subscription</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">
            {subscription ? "saved on device" : "none"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Badging API</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">
            {badgeApi ? "yes" : "no"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">VAPID env</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">
            {envInfo
              ? `pub ${envInfo.hasPublicKey ? "ok" : "MISSING"} / priv ${envInfo.hasPrivateKey ? "ok" : "MISSING"}`
              : "checking…"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Status</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">{status}</dd>
        </div>
      </dl>

      <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">{detail}</p>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={busy || status === "unsupported"}
          onClick={() => void onEnable()}
          className="h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {subscription ? "Re-enable / refresh subscription" : "Enable notifications"}
        </button>
        <button
          type="button"
          disabled={!canSend}
          onClick={() => void onSendDelayed()}
          className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-100"
        >
          Send badge in 10s (then close app)
        </button>
        <button
          type="button"
          disabled={!canSend}
          onClick={() => void onSendNow()}
          className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-100"
        >
          Send background badge now
        </button>
        <button
          type="button"
          disabled={busy || !badgeApi}
          onClick={() => void onSetForeground()}
          className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-100"
        >
          Set badge now (Badging API — desktop)
        </button>
        <button
          type="button"
          disabled={busy || !subscription}
          onClick={() => void onDisable()}
          className="h-11 rounded-xl px-4 text-sm font-medium text-zinc-500 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-zinc-200"
        >
          Disable push on this device
        </button>
      </div>

      {lastAction ? (
        <p className="text-sm leading-6 text-emerald-700 dark:text-emerald-400">
          {lastAction}
        </p>
      ) : null}

      <details className="rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
        <summary className="cursor-pointer font-medium text-zinc-800 dark:text-zinc-100">
          Debug details
        </summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[0.75em] leading-5 text-zinc-600 dark:text-zinc-400">
          {JSON.stringify(
            {
              platform,
              browser,
              standalone,
              permission,
              status,
              swReady,
              badgeApi,
              hasSubscription: Boolean(subscription),
              vapidPublicInClient: Boolean(PUBLIC_VAPID_KEY),
              envInfo,
              endpointPreview: subscription?.endpoint?.slice(0, 64) ?? null,
              userAgent: ua,
            },
            null,
            2
          )}
        </pre>
      </details>
    </section>
  );
}
