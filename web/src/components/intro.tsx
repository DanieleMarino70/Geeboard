import { ChevronRight } from "lucide-react";

/* A page's introduction: one sentence that says what the page is for, and the rest behind "How it works".

   DNS, Notifications, Updates and Backups explained themselves in a paragraph ahead of their first control, and on a phone that was ten to
   thirteen lines to scroll past every visit (the UI/UX audit of 2026-10-11). Nothing was taken out: what was said is still said, a click
   away, for whoever has not read it yet. A native disclosure, so it opens with a keyboard and a screen reader says whether it is open. */
export function Intro({ lead, children }: { lead: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-[7px] max-w-[74ch] text-[12.5px] leading-snug text-ink-3">
      <p>{lead}</p>
      <details className="group mt-[4px]">
        <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded-sm text-accent-fg select-none hover:underline [&::-webkit-details-marker]:hidden">
          <ChevronRight size={13} strokeWidth={2} aria-hidden className="transition-transform duration-150 group-open:rotate-90" />
          How it works
        </summary>
        <div className="mt-[6px] flex flex-col gap-2 border-l border-line pl-3">{children}</div>
      </details>
    </div>
  );
}
