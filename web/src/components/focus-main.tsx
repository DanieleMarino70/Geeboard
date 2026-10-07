"use client";

import { useEffect } from "react";

/* Where focus is after a navigation.

   Every page draws its own shell, so a click on the sidebar replaces the sidebar, and the link that had focus was gone with it: focus was left
   on the document, the next Tab went to the first of twenty-two controls ahead of the page, and Next's own attempt to focus the new page
   lands on a container that cannot take it. This puts focus on the page's main region once the new page is there, so that a keyboard user is
   at its start and a screen reader reads from it. Not on the first load of the document: that is the browser's to start, at the top. */
let seen = false;

export function FocusMain() {
  useEffect(() => {
    if (!seen) {
      seen = true;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: true });
  }, []);
  return null;
}

/** The link that is the first Tab stop of every page: visible only when it has focus. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:border focus:border-line-2 focus:bg-card focus:px-4 focus:py-2 focus:text-[13px] focus:font-medium focus:text-ink focus:outline-2 focus:outline-offset-2 focus:outline-accent"
    >
      Skip to content
    </a>
  );
}
