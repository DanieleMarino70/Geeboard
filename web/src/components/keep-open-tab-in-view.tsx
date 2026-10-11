"use client";

import { useEffect, useRef } from "react";

/* Drawn inside a row of tabs that scrolls (server-tabs.tsx): when the page opens, the row is scrolled so that the open tab is not off its
   end. On a phone Settings is the last of eight, and the row used to open at Overview with the tab you were on out of sight. The row
   scrolls and not the window: scrollIntoView would move the page too. */
export function KeepOpenTabInView() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const row = marker.current?.parentElement;
    const open = row?.querySelector<HTMLElement>("[data-open]");
    if (!row || !open || row.scrollWidth <= row.clientWidth) return;
    // Clear of the faded strip at the edge (gb-tabs-scroll, globals.css).
    const beyond = open.getBoundingClientRect().right - row.getBoundingClientRect().right + 40;
    if (beyond > 0) row.scrollLeft += beyond;
  }, []);
  return <span ref={marker} hidden />;
}
