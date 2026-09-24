"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check, LoaderCircle } from "lucide-react";
import { Meter } from "@/components/ui";
import type { InstallProgressView } from "@/lib/install-progress";

/* An install, watched while the call that runs it is still out.

   The page that starts an install makes up a key, sends it with the call,
   and asks /api/install-progress about it once a second until the call
   answers. What comes back is the installer's step and sentence — and
   while the node is downloading, the layers and bytes it counted, with a
   bar only when those numbers make one: the layers are known at once,
   the size of the whole only once every layer has begun. */

/* A key for one install. getRandomValues rather than randomUUID, which
   browsers offer only on https or localhost: a panel opened on a plain
   http address would have failed to create anything at all. */
export function newProgressKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function useInstallProgress(key: string | null): InstallProgressView | null {
  // Tagged with its key, so a new install never shows the last one's step.
  const [seen, setSeen] = useState<{ key: string; progress: InstallProgressView } | null>(null);
  useEffect(() => {
    if (!key) return;
    let stopped = false;
    const ask = async () => {
      try {
        const res = await fetch(`/api/install-progress?key=${key}`, { cache: "no-store" });
        const body = (await res.json()) as { progress: InstallProgressView | null };
        // Keep the last step on screen rather than blanking it between polls.
        if (!stopped && body.progress) setSeen({ key, progress: body.progress });
      } catch {
        /* the call's own answer is what matters; this is a courtesy */
      }
    };
    const timer = setInterval(ask, 1000);
    void ask();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [key]);
  return seen && seen.key === key ? seen.progress : null;
}

/** The installer's steps, in its order. */
export const INSTALL_STEPS = [
  { id: "prepare", label: "Prepare" },
  { id: "download", label: "Download the build" },
  { id: "provision", label: "Create it on the node" },
  { id: "configure", label: "Write its settings" },
  { id: "start", label: "Start" },
] as const;

export function InstallSteps({ progress }: { progress: InstallProgressView | null }) {
  const at = progress ? INSTALL_STEPS.findIndex((s) => s.id === progress.step) : -1;
  return (
    <ol className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
      {INSTALL_STEPS.map((s, i) => (
        <li
          key={s.id}
          className={clsx(
            "inline-flex items-center gap-[6px]",
            i < at ? "text-ink-3" : i === at ? "font-medium text-ink" : "text-ink-4",
          )}
        >
          {i < at ? (
            <Check size={12} strokeWidth={2.2} className="text-success" />
          ) : i === at ? (
            <LoaderCircle size={12} strokeWidth={2.2} className="animate-spin text-accent" />
          ) : (
            <span className="inline-block h-[5px] w-[5px] rounded-full bg-line-2" />
          )}
          {s.label}
        </li>
      ))}
    </ol>
  );
}

/* The sentence, and under it the download's bar when there is one. A
   download whose size is not known yet says so instead of drawing a bar
   that would jump backwards when the next layer's size arrives. */
export function InstallProgressDetail({
  progress,
  waiting,
}: {
  progress: InstallProgressView | null;
  /** What to say before the first answer. */
  waiting: string;
}) {
  if (!progress) return <p className="text-[11px] leading-snug text-ink-4">{waiting}</p>;
  const downloading = progress.step === "download" && progress.download;
  return (
    <div className="flex flex-col gap-[6px]">
      <p className="text-[11px] leading-snug text-ink-3">
        {progress.message}.
        {downloading && progress.percent === null && progress.download?.phase === "downloading"
          ? " The whole size is known once every layer has begun."
          : ""}
      </p>
      {downloading && progress.percent !== null && (
        <div className="flex items-center gap-[10px]">
          <div className="min-w-0 flex-1">
            <Meter value={progress.percent} />
          </div>
          <span className="shrink-0 font-mono text-[10.5px] text-ink-4">{progress.percent}%</span>
        </div>
      )}
    </div>
  );
}
