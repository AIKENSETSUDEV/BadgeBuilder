import { AppBadge } from "./components/AppBadge";

// Allow delayed push (`after()` + 10s wait) to finish on Vercel.
export const maxDuration = 60;

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="flex w-full max-w-lg flex-col items-center gap-8 text-center">
        <div className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">
            PWA
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Badge Test
          </h1>
          <p className="text-base leading-7 text-zinc-600 dark:text-zinc-400">
            Android Chrome: closed-app icon badge comes from an{" "}
            <strong>unread push notification</strong>. Desktop Edge: numeric{" "}
            <code className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-sm dark:bg-zinc-800">
              setAppBadge
            </code>
            .
          </p>
        </div>
        <AppBadge />
      </main>
    </div>
  );
}
