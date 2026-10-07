"use client";

import { useSyncExternalStore } from "react";

/* A choice that belongs to one person in one browser — the console read aloud, the terminal in screen-reader mode — and is kept there.

   A store and not state set from an effect: the page is drawn on the server with the default, and the browser's own answer replaces it
   when it hydrates, with no flash of the wrong one and no second render for it. Where storage is not there (a private window, a
   blocked site) the choice holds in memory, for this page, and nothing throws. */

const listeners = new Map<string, Set<() => void>>();
const memory = new Map<string, boolean>();

function read(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    return memory.get(key) ?? fallback;
  }
  return memory.get(key) ?? fallback;
}

function subscribe(key: string, listener: () => void) {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    set.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** `[on, flip]`: whether the flag is set in this browser, and a function that turns it over. */
export function useLocalFlag(key: string, fallback = false): [boolean, () => void] {
  const on = useSyncExternalStore(
    (listener) => subscribe(key, listener),
    () => read(key, fallback),
    () => fallback,
  );
  const flip = () => {
    const next = !read(key, fallback);
    memory.set(key, next);
    try {
      window.localStorage.setItem(key, next ? "1" : "0");
    } catch {
      /* held in memory */
    }
    listeners.get(key)?.forEach((listener) => listener());
  };
  return [on, flip];
}
