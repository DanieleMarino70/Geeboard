"use client";

import type { AwayReason } from "@/domain/nodes/away";
import { LocalTime } from "./local-time";

/* "fra-node-02 unreachable since 14:03", in the reader's own clock: the line under an Unknown pill, and in the server page's header.
   The time is the last time the panel reached the node, which is the last time anything on it was known. */
export function NodeAway({ node, reason, since }: { node: string; reason: AwayReason; since: string | null }) {
  return (
    <span>
      <span className="font-mono">{node}</span> {reason === "unreachable" ? "unreachable" : "not answering"}
      {since ? (
        <>
          {" since "}
          <LocalTime at={since} style="datetime" fallback="the last time it was reached" />
        </>
      ) : (
        " (never reached)"
      )}
    </span>
  );
}
