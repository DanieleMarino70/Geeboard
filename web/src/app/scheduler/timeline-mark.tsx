"use client";

import { useId, useState } from "react";
import clsx from "clsx";
import { TASK_KIND_LABEL } from "@/lib/task-rules";
import { KIND, type Kind } from "./kinds";

/* The most times a mark lists for one task: a task every five minutes is thirty-six in a phone's three-hour slot, and the rest is a count. */
const LISTED = 8;

type Firing = { at: string; name: string; kind: Kind; task: string };

/* A slot's firings as its tasks, each once with its times: a half-hourly task is one line, not one line a run. */
function byTask(firings: Firing[]) {
  const tasks = new Map<string, { task: string; name: string; kind: Kind; times: string[] }>();
  for (const f of firings) {
    const t = tasks.get(f.task) ?? { task: f.task, name: f.name, kind: f.kind, times: [] };
    t.times.push(f.at);
    tasks.set(f.task, t);
  }
  return [...tasks.values()];
}

/* Which kind a slot shows when it holds more than one, the weightiest first. */
const WEIGHT: Kind[] = ["RESTART", "BACKUP", "CLEANUP", "VERIFY", "COMMAND", "BROADCAST"];

/* One slot of the Scheduler's timeline (lib/timeline.ts): one icon, a count when there is more than one firing in it, and the list of
   which and when on a pointer, on focus, or on a tap. Escape puts the list away; it stays while the pointer is over it, so it can be read
   and selected. The list is what describes the mark to a screen reader, open or not. */
export function TimelineMark({
  left,
  align,
  span,
  firings,
}: {
  /** Where the mark sits on the line, in percent. */
  left: number;
  /** Which way the list opens, so that one near an end of the line stays on the card. */
  align: "start" | "center" | "end";
  /** The slot's times, "12:00–14:00". */
  span: string;
  firings: Firing[];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const count = firings.length;
  // The kind that does the most to a server, for the icon: a nightly backup among the half-hourly broadcasts is the one worth seeing. The list says the rest.
  const kind = WEIGHT.find((k) => firings.some((f) => f.kind === k)) ?? firings[0].kind;
  const { icon: Icon, colour } = KIND[kind];
  const label =
    count === 1 ? `${firings[0].name}, ${TASK_KIND_LABEL[kind].toLowerCase()} at ${firings[0].at} UTC` : `${count} runs, ${span} UTC`;

  return (
    <div
      className="absolute top-[16px] -translate-x-1/2 max-sm:top-[18px]"
      style={{ left: `${left}%` }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={`${id}-list`}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className="relative grid h-[30px] w-[30px] place-items-center rounded-[9px] border border-line bg-card-2 shadow-e1 transition-colors duration-150 hover:border-line-2 max-sm:h-[26px] max-sm:w-[26px]"
        style={{ color: colour }}
      >
        <Icon size={14} strokeWidth={1.7} aria-hidden />
        {count > 1 && (
          <span
            aria-hidden
            className="absolute -top-[7px] -right-[9px] rounded-full border border-line bg-surface px-[4px] font-mono text-[9px] leading-[14px] font-medium text-ink-2 tnum"
          >
            ×{count}
          </span>
        )}
      </button>
      <div
        id={`${id}-list`}
        className={clsx(
          "absolute bottom-full z-20 pb-2",
          align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
          !open && "hidden",
        )}
      >
        <div className="w-max max-w-[240px] rounded-lg border border-line-2 bg-surface px-3 py-2 text-left shadow-e2">
          <div className="mb-1 font-mono text-[9.5px] tracking-[0.06em] text-ink-4 uppercase">
            {count === 1 ? "1 run" : `${count} runs`} · {span} UTC
          </div>
          <ul className="flex flex-col gap-[6px]">
            {byTask(firings).map((t) => (
              <li key={t.task} className="text-[11.5px] leading-snug">
                <span className="flex items-center gap-[7px]">
                  <span className="h-[7px] w-[7px] shrink-0 rounded-[2px]" style={{ background: KIND[t.kind].colour }} aria-hidden />
                  <span className="min-w-0 truncate text-ink-2">{t.name}</span>
                  {t.times.length > 1 && <span className="font-mono text-[10px] text-ink-4">×{t.times.length}</span>}
                </span>
                <span className="mt-[1px] block pl-[14px] font-mono text-[10.5px] text-ink-3 tnum">
                  {t.times.slice(0, LISTED).join(" ")}
                  {t.times.length > LISTED ? ` and ${t.times.length - LISTED} more` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
