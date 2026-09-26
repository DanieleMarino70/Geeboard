"use client";

import { useCallback, useEffect, useState } from "react";
import { classifyServerLine, type LogLine } from "@/lib/console-fixture";

/* Subscribes to the panel's SSE proxy and turns raw server output
   into the levelled lines the console renders.

   Pausing is deliberately not handled here: the stream keeps running
   and the view simply stops following it, so nothing is missed while
   an operator reads back through the output. */

export type StreamState = "connecting" | "live" | "faulted" | "ended" | "no-agent";

interface Options {
  slug: string;
  enabled: boolean;
  limit?: number;
}

export function useConsoleStream({ slug, enabled, limit = 500 }: Options) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connection, setConnection] = useState<"connecting" | "live" | "faulted" | "ended">("connecting");
  const [fault, setFault] = useState<string | null>(null);
  /* Why the panel closed the stream on purpose — the reader's role, their
     session, the server gone. Not a fault: reconnecting would not help. */
  const [ended, setEnded] = useState<string | null>(null);

  // Derived, so a node with no agent never needs a state write.
  const state: StreamState = enabled ? connection : "no-agent";

  useEffect(() => {
    if (!enabled) return;

    const source = new EventSource(`/api/servers/${encodeURIComponent(slug)}/console`);
    let live = true;
    /* The node sends its recent lines each time the stream opens, and
       EventSource reopens it by itself after a server restarts. A line
       already here — the same time from Docker, the same text — is the
       same line. An agent before 0.3.1 stamps the moment it sends, and
       its repeats cannot be told from new lines. */
    const seen = new Set<string>();

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
        // Blank lines are left out here and in the backlog alike; Terraria's are only bytes-order marks.
        if (!text || !text.trim()) return;
        if (data.at) {
          const key = `${data.at}|${text}`;
          if (seen.has(key)) return;
          seen.add(key);
        }
        setLines((prev) => {
          const next = [
            ...prev,
            // The time is the reader's to see in their own clock: formatted where it is shown.
            { time: "", at: data.at, level: classifyServerLine(text, Boolean(data.stderr)), message: text },
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

    /* Closed here as well as by the panel: EventSource reopens a stream
       that ends by itself, and this one would be refused, leaving only
       "disconnected" where the reason had been. */
    source.addEventListener("ended", (event) => {
      if (!live) return;
      source.close();
      // Gone, not hidden: what the reader may no longer watch is not kept in the page either.
      setLines([]);
      try {
        const data = JSON.parse((event as MessageEvent).data) as { reason?: string };
        setEnded(data.reason ?? "The panel closed the console.");
      } catch {
        setEnded("The panel closed the console.");
      }
      setConnection("ended");
    });

    source.onerror = () => {
      // EventSource retries on its own; only report a give-up.
      if (live && source.readyState === EventSource.CLOSED) {
        setConnection((now) => (now === "ended" ? now : "faulted"));
      }
    };

    return () => {
      live = false;
      source.close();
    };
  }, [slug, enabled, limit]);

  const clear = useCallback(() => setLines([]), []);

  return { lines, state, fault, ended, clear };
}
