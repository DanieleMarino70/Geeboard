"use client";

import clsx from "clsx";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { COPY_FAILED_HINT, useCopy } from "./use-copy";

/* A Copy button that says what happened. "Copied" is said only when the browser said it was; when it was not allowed, the button
   says "Not copied", what it shows is selected (`source`), and a line says what to press. The result is also said to a screen reader,
   which the label changing under a focused button is not enough for. */
export function CopyButton({
  text,
  source,
  label = "Copy",
  className,
}: {
  text: string;
  /** The element that shows `text`; selected when copying was not allowed, so that Ctrl+C is the one step left. */
  source?: React.RefObject<HTMLElement | null>;
  label?: string;
  className?: string;
}) {
  const { state, copy } = useCopy(text, source);
  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        className={clsx(
          "inline-flex shrink-0 items-center gap-[6px] rounded-lg border border-line bg-card px-3 py-[6px] text-xs font-medium text-ink-2 transition-colors duration-150 hover:border-line-2 hover:text-ink",
          className,
        )}
      >
        {state === "copied" ? <Check size={13} strokeWidth={2.2} /> : state === "failed" ? <TriangleAlert size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.9} />}
        {state === "copied" ? "Copied" : state === "failed" ? "Not copied" : label}
      </button>
      <span role="status" className={state === "failed" ? "basis-full text-[11px] leading-snug text-warning-fg" : "sr-only"}>
        {state === "copied" ? "Copied to the clipboard." : state === "failed" ? COPY_FAILED_HINT : ""}
      </span>
    </>
  );
}
