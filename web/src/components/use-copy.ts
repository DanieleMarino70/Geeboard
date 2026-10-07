"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Copying, and saying whether it happened.

   Every Copy button in the panel called `navigator.clipboard?.writeText(secret)` and then said "Copied", whether or not anything was: the
   clipboard API does not exist outside a secure context (a panel reached by a LAN address over http, which is how a panel is first
   reached), and where it does exist the promise rejects without permission and was not awaited. The recovery codes are what stands between
   an owner and a lockout, and "Copied" was said over nothing. This waits for the answer, tries the old way (a text area and
   `execCommand`), and reports what the two of them said. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* refused: the old way may not be */
  }
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  before?.focus();
  return ok;
}

/** Selects what an element shows, so that when copying did not work the person is one keystroke from doing it themselves. */
function selectContents(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

export type CopyState = "idle" | "copied" | "failed";

/** Copy `text`. When it could not be copied, `source` (the element that shows it) is selected and the state says so. */
export function useCopy(text: string, source?: React.RefObject<HTMLElement | null>) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    const ok = await copyText(text);
    if (!ok && source?.current) selectContents(source.current);
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), ok ? 2000 : 10000);
  }, [text, source]);

  return { state, copy };
}

/** What a Copy button says, and what is said to a screen reader after it. */
export const COPY_LABEL: Record<CopyState, string> = { idle: "Copy", copied: "Copied", failed: "Not copied" };
export const COPY_FAILED_HINT = "The browser did not allow copying. It is selected: press Ctrl+C (or Cmd+C).";
