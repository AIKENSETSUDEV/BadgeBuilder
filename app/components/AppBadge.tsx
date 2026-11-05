"use client";

import { useEffect, useState } from "react";
import {
  scheduleBackgroundBadge,
  sendBackgroundBadge,
  subscribeUser,
  unsubscribeUser,
} from "@/app/actions";

const TEST_BADGE_COUNT = 5;
const PUBLIC_VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

type Status =
  | "idle"
  | "ready"
  | "unsupported"
  | "permission-needed"
  | "error";

type BrowserKind = "edge" | "chrome" | "safari" | "other";

declare global {
  interface Navigator {
    setAppBadge?: (contents?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  }
}

function detectBrowser(): BrowserKind {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "edge";
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "safari";
  return "other";
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

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
}

export function AppBadge() {
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState("Initializing…");
  const [swReady, setSwReady] = useState(false);
  const [pushReady, setPushReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [browser, setBrowser] = useState<BrowserKind>("other");
  const [standalone, setStandalone] = useState(false);
  const [badgeApi, setBadgeApi] = useState(false);

  useEffect(() => {
    setBrowser(detectBrowser());
    setBadgeApi(typeof navigator.setAppBadge === "function");
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        ("standalone" in navigator &&
          Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
    );

    let cancelled = false;

    async function setup() {
      try {
        const registration = await registerServiceWorker();
        if (cancelled) return;
        setSwReady(Boolean(registration));

        const permission =
          "Notification" in window
            ? Notification.permission === "granted"
              ? "granted"
              : await Notification.requestPermission()
            : null;

        if (cancelled) return;

        if (permission !== "granted") {
          setStatus("permission-needed");
          setDetail(
            "Notification permission is required for background badge updates (and for iOS badges)."
          );
          return;
        }

        if (!PUBLIC_VAPID_KEY) {
          setStatus("error");
          setDetail(
            "Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY. Check .env.local and restart."
          );
          return;
        }

        if (!registration || !("PushManager" in window)) {
          setStatus("unsupported");
          setDetail("PushManager is not available in this browser.");
          return;
        }

        await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY),
          });
        }

        const serialized = JSON.parse(JSON.stringify(subscription)) as {
          endpoint: string;
          keys: { p256dh: string; auth: string };
        };
        await subscribeUser(serialized);
        if (cancelled) return;

        setPushReady(true);
        // Intentionally do NOT call setAppBadge on load — that masked closed-app tests.
        setStatus("ready");
        setDetail(
          "Push subscribed. Badge is only set by push/SW or the foreground button below."
        );
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setDetail(err instanceof Error ? err.message : "Setup failed");
      }
    }

    void setup();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSetForeground() {
    setBusy(true);
    setLastAction(null);
    try {
      if (!navigator.setAppBadge) {
        setLastAction("setAppBadge not available in this browser.");
        return;
      }
      await navigator.setAppBadge(TEST_BADGE_COUNT);
      setLastAction(
        `Foreground setAppBadge(${TEST_BADGE_COUNT}) OK. On Chrome this only stays while the installed PWA window is open.`
      );
    } catch (err) {
      setLastAction(err instanceof Error ? err.message : "Foreground badge failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSendNow() {
    setBusy(true);
    setLastAction(null);
    const result = await sendBackgroundBadge(TEST_BADGE_COUNT);
    setBusy(false);
    setLastAction(
      result.ok
        ? `Push sent (target badge ${result.count}). Check the notification body for SW diagnostics.`
        : result.error
    );
  }

  async function onSendDelayed() {
    setBusy(true);
    setLastAction(null);
    const result = await scheduleBackgroundBadge(10_000, TEST_BADGE_COUNT);
    setBusy(false);
    if (!result.ok) {
      setLastAction(result.error);
      return;
    }
    if (browser === "chrome") {
      setLastAction(
        `Scheduled in ${result.delayMs / 1000}s. Chrome will NOT show a closed-app badge — minimize (keep window alive) for Chrome, or reinstall/open this PWA in Edge for closed-app badges.`
      );
    } else if (browser === "edge") {
      setLastAction(
        `Scheduled in ${result.delayMs / 1000}s. Close the installed Edge PWA now — taskbar badge ${result.count} should appear when the push arrives.`
      );
    } else {
      setLastAction(
        `Scheduled in ${result.delayMs / 1000}s. Close/minimize the installed app before the push fires.`
      );
    }
  }

  async function onDisable() {
    setBusy(true);
    const registration = await navigator.serviceWorker.getRegistration();
    const sub = await registration?.pushManager.getSubscription();
    await sub?.unsubscribe();
    await unsubscribeUser();
    if (navigator.clearAppBadge) await navigator.clearAppBadge();
    setPushReady(false);
    setBusy(false);
    setLastAction("Background push disabled and badge cleared.");
  }

  return (
    <section className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 text-left shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Background app badge
        </h2>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Push is working (you got the toast). The missing icon badge is a{" "}
          <strong>browser/OS paint limit</strong>, not a failed push.
        </p>
      </div>

      <div
        className={`rounded-xl px-3 py-3 text-sm leading-6 ${
          browser === "chrome"
            ? "bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
            : "bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100"
        }`}
      >
        {browser === "chrome" ? (
          <>
            You are on <strong>Chrome</strong>. Chrome can call{" "}
            <code className="font-mono text-[0.85em]">setAppBadge</code> from the
            service worker, but on Windows it does <strong>not</strong> show the
            badge while the PWA is fully closed. Use <strong>Microsoft Edge</strong>{" "}
            (install the PWA from Edge) for closed/taskbar badges, or keep the
            Chrome PWA <strong>minimized</strong> (window still open).
          </>
        ) : browser === "edge" ? (
          <>
            You are on <strong>Edge</strong> — closed-app taskbar badges are
            supported. Install this site as a PWA from Edge, allow notifications,
            then use the delayed send and fully close the app.
          </>
        ) : (
          <>
            Detected browser: {browser}. Closed-app numeric badges are most
            reliable on Edge (Windows) and Safari (iOS installed PWA).
          </>
        )}
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Installed / standalone</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">
            {standalone ? "yes" : "no — install PWA first"}
          </dd>
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
            {pushReady ? "ready" : "pending"}
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
          disabled={busy || status !== "ready"}
          onClick={() => void onSendDelayed()}
          className="h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {browser === "chrome"
            ? "Send badge in 10s (then minimize — or use Edge)"
            : "Send badge in 10s (then close app)"}
        </button>
        <button
          type="button"
          disabled={busy || status !== "ready"}
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
          Set badge now (foreground only)
        </button>
        <button
          type="button"
          disabled={busy || !pushReady}
          onClick={() => void onDisable()}
          className="h-11 rounded-xl px-4 text-sm font-medium text-zinc-500 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-zinc-200"
        >
          Disable push / clear badge
        </button>
      </div>

      {lastAction ? (
        <p className="text-sm leading-6 text-emerald-700 dark:text-emerald-400">
          {lastAction}
        </p>
      ) : null}

      <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        <li>
          For <strong>closed-app</strong> badges on Windows: open this site in{" "}
          <strong>Edge</strong>, install as app, allow notifications.
        </li>
        <li>
          Hard-refresh once so the updated service worker installs (notification
          body now includes badge diagnostics).
        </li>
        <li>Click delayed send, then close the Edge PWA (or minimize on Chrome).</li>
        <li>
          Read the toast: it should say <code className="font-mono">setAppBadge(5) resolved</code>.
          On Edge the taskbar icon should also show {TEST_BADGE_COUNT}.
        </li>
      </ol>
    </section>
  );
}
