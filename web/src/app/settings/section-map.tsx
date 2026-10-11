"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";

export interface Section {
  id: string;
  label: string;
  /** Settings in this section that differ from what is saved. */
  pending?: number;
}

/* Where each part of the Settings page is, kept in view under the top bar as the page scrolls: the game's settings, the server's own, what
   is done to the server rather than set on it, and deleting it. On a phone it is one row that scrolls sideways.

   The game's settings were the last thing on the page, three thousand pixels down on a phone, after the owner, the move, the copy and the
   Danger zone, and they are what an operator changes most. They come first now, and the Danger zone last, always. */
export function SectionMap({ sections }: { sections: Section[] }) {
  const [current, setCurrent] = useState(sections[0]?.id);

  // The section being read is the one nearest the top of the window, under the bars.
  useEffect(() => {
    const targets = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => e !== null);
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, boolean>();
    // At the foot of the page the last section is the one being read, though it is too short to reach the top: the Danger zone always is.
    const atEnd = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    const pick = () => {
      const first = atEnd() ? targets[targets.length - 1] : targets.find((t) => seen.get(t.id));
      if (first) setCurrent(first.id);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
        pick();
      },
      { rootMargin: "-120px 0px -55% 0px" },
    );
    for (const target of targets) observer.observe(target);
    window.addEventListener("scroll", pick, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", pick);
    };
  }, [sections]);

  return (
    <nav
      aria-label="Sections of this page"
      className="sticky top-14 z-20 -mx-5 border-b border-line bg-glass px-5 backdrop-blur-[16px] backdrop-saturate-150 sm:-mx-8 sm:px-8"
    >
      <ul className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
        {sections.map((section) => (
          <li key={section.id} className="shrink-0">
            <a
              href={`#${section.id}`}
              aria-current={current === section.id ? "location" : undefined}
              onClick={() => setCurrent(section.id)}
              className={clsx(
                "inline-flex min-h-8 items-center gap-[7px] rounded-lg px-3 py-[6px] text-[12px] whitespace-nowrap transition-colors duration-150",
                current === section.id ? "bg-card-2 font-medium text-ink" : "text-ink-3 hover:text-ink-2",
              )}
            >
              {section.label}
              {section.pending ? (
                <span className="rounded-full bg-accent-soft px-[6px] font-mono text-[10px] text-accent-fg">
                  {section.pending}
                  <span className="sr-only"> unsaved</span>
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
