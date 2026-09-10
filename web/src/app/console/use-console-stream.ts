"use client";

import { useCallback, useEffect, useState } from "react";
import { classifyServerLine, type LogLine } from "@/lib/console-fixture";

/* Subscribes to the panel's SSE proxy and turns raw server output
   into the levelled lines the console renders.

   Pausing is deliberately not handled here: the stream keeps running
   and the view simply stops following it, so nothing is missed while
   an operator reads back through the output. */

export type StreamState = "connecting" | "live" | "faulted" | "no-agent";

function timeOf(iso: string | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  return Number.isNaN(d.getTime())
    ? new Date().toLocaleTimeString("en-GB", { hour12: false })
    : d.toLocaleTimeString("en-GB", { hour12: false });
}

interface Options {
  slug: string;
  enabled: boolean;
  limit?: number;
}

export function useConsoleStream({ slug, enabled, limit = 500 }: Options) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connection, setConnection] = useState<"connecting" | "live" | "faulted">("connecting");
  const [fault, setFault] = useState<string | null>(null);

  // Derived, so a node with no agent never needs a state write.
  const state: StreamState = enabled ? connection : "no-agent";

  useEffect(() => {
    if (!enabled) return;

    const source = new EventSource(`/api/servers/${encodeURIComponent(slug)}/console`);
    let live = true;

    source.addEventListener("open", () => {
      if (!live) return;
      setConnection("live");
      setFault(null);
    });

    source.addEventListener("line", (event) => {
      if (!live) return;
      try {
        const data = JSON.parse((event as MessageEvent).data) as {
          at?: string;
          line?: string;
          stderr?: boolean;
        };
        const text = data.line;
        if (!text) return;
        setLines((prev) => {
          const next = [
            ...prev,
            { time: timeOf(data.at), level: classifyServerLine(text, Boolean(data.stderr)), message: text },
          ];
          return next.length > limit ? next.slice(next.length - limit) : next;
        });
      } catch {
        /* a frame we cannot read is not worth dropping the stream for */
      }
    });

    source.addEventListener("fault", (event) => {
      if (!live) return;
      try {
        const data = JSON.parse((event as MessageEvent).data) as { error?: string };
        setFault(data.error ?? "the console stream ended");
      } catch {
        setFault("the console stream ended");
      }
      setConnection("faulted");
    });

    source.onerror = () => {
      // EventSource retries on its own; only report a give-up.
      if (live && source.readyState === EventSource.CLOSED) setConnection("faulted");
    };

    return () => {
      live = false;
      source.close();
    };
  }, [slug, enabled, limit]);

  const clear = useCallback(() => setLines([]), []);

  return { lines, state, fault, clear };
}
