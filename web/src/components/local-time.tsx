"use client";

import { useSyncExternalStore } from "react";

/* A time in the reader's own clock.

   A client component is rendered once on the server, in the server's time zone, and again in the browser, in the reader's: the two texts
   differ on any machine that is not in the reader's zone (a VPS in UTC, a reader in Rome), React reports a hydration mismatch and draws it
   again, and for a moment the page shows the server's hour. The console knew and kept a flag of its own. This is that flag, once: nothing
   (or the fallback) until the browser has taken over, then the time as the reader's clock says it. */

const noSubscription = () => () => {};

/** False while the page is being drawn on the server and in the browser's first pass over it, true after. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

type Style = "time" | "date" | "datetime";

const FORMAT: Record<Style, Intl.DateTimeFormatOptions> = {
  time: { hour: "2-digit", minute: "2-digit" },
  date: { day: "numeric", month: "short", year: "numeric" },
  datetime: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
};

export function LocalTime({
  at,
  style = "time",
  fallback = "",
}: {
  at: string | Date | null | undefined;
  style?: Style;
  /** What is there until the browser has taken over. Empty by default: a wrong hour for an instant is worse than none. */
  fallback?: string;
}) {
  const hydrated = useHydrated();
  if (!at) return <>{fallback}</>;
  const date = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return <>{fallback}</>;
  return (
    <time dateTime={date.toISOString()} suppressHydrationWarning>
      {hydrated ? date.toLocaleString(undefined, FORMAT[style]) : fallback}
    </time>
  );
}
