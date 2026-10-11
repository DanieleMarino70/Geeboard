"use client";

import { useId } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";

/* The server switcher on a phone (server-switcher.tsx): the same choices as a select, which opens the phone's own picker and goes to the
   server chosen when it closes. */
export function ServerSelect({
  choices,
  className,
}: {
  choices: Array<{ href: string; label: string; on: boolean }>;
  className?: string;
}) {
  const router = useRouter();
  const id = useId();
  const current = choices.find((c) => c.on)?.href ?? "";
  return (
    <div className={clsx("flex items-center gap-[10px]", className)}>
      <label htmlFor={id} className="shrink-0 font-mono text-[10px] tracking-[0.08em] text-ink-4 uppercase">
        Server
      </label>
      <select
        id={id}
        value={current}
        onChange={(event) => router.push(event.target.value)}
        className="min-w-0 flex-1 rounded-[9px] border border-control bg-bg-2 px-3 py-[8px] text-[13px] text-ink transition-colors duration-150 hover:border-ink-4 focus:border-accent-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {current === "" && <option value="">Choose a server</option>}
        {choices.map((c) => (
          <option key={c.href} value={c.href}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}
