"use client";

import { useLinkStatus } from "next/link";
import clsx from "clsx";

/* A click on a link that has been made and has not been answered yet.

   Every page is dynamic, so a click on the sidebar left the old page on screen until the new one was whole, and on a slow read that looked
   like a click that did nothing. This is drawn inside a link, and says so while that link's navigation is pending: a dot that appears after
   a moment (a navigation that is quick never shows it) and a word for a screen reader.

   It is this and not a `loading.tsx`, which would show an outline at once and was tried: a page inside a loading boundary starts streaming
   before it has asked who is signed in, so a signed-out request, or one that has to go to the account page, is answered 200 with a redirect
   for the browser to follow and not the 307 every gate and every check of one expects. */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span
        aria-hidden
        className={clsx(
          "h-[6px] w-[6px] shrink-0 rounded-full bg-accent transition-opacity duration-150",
          pending ? "animate-(--animate-pulse-dot) opacity-100 delay-200" : "opacity-0",
          className,
        )}
      />
      {pending ? <span className="sr-only">Loading</span> : null}
    </>
  );
}
