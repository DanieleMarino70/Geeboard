"use client";

import { useSyncExternalStore } from "react";
import { STATE_META, type OptimisticState } from "@/lib/state-meta";
import type { Tone } from "@/lib/ui-types";
import { Pill } from "./ui";

/* The pill that says what is happening the moment a button is pressed.

   Stop and Restart hold the request open for the game's own save and exit, up to a minute, and the page was not redrawn until the request
   came back: the pressed button was merely greyed, the pill still said "Running", and a second press appeared to do nothing. The button
   that is pressed tells this module, by the server's slug, what the server is about to be; every pill for that server says it at once, and
   goes back to what the server says when the request returns. */

const pending = new Map<string, OptimisticState>();
const listeners = new Set<() => void>();

export function setPendingState(slug: string, state: OptimisticState | null): void {
  if (state) pending.set(slug, state);
  else pending.delete(slug);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePendingState(slug: string): OptimisticState | null {
  return useSyncExternalStore(
    subscribe,
    () => pending.get(slug) ?? null,
    () => null,
  );
}

export function StatePill({ slug, tone, label, pulse }: { slug: string; tone: Tone; label: string; pulse: boolean }) {
  const now = usePendingState(slug);
  const shown = now ? STATE_META[now] : { tone, label, pulse };
  return (
    <Pill tone={shown.tone} pulse={shown.pulse}>
      {shown.label}
    </Pill>
  );
}
