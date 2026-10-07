/* A node the panel cannot see, and what a page should do about it.

   A node is called degraded after thirty seconds of silence and unreachable after two minutes (domain/nodes/health.ts), and the poller then
   skips it: its servers keep the last state and the last player count they had, so the dashboard showed a green "Running" and "12 / 40" on a
   machine that had been gone for an hour, and the pages that ask the node something while they draw (the console's backlog, the settings'
   files on the node) waited ten seconds, and twenty for a game with two files, for an answer from one that was not going to give it. Here is
   the one place that says whether a node is away; the pages, the server rows and the reads all ask it. Pure. */

export type AwayReason = "unreachable" | "degraded";

export interface Away {
  reason: AwayReason;
  /** The last time the panel reached it: the "since" of "unreachable since 14:03". Null for a node it never reached. */
  since: Date | null;
}

export interface NodeSeen {
  state: string;
  lastReachedAt: Date | null;
}

/** Null when the node is answering (or is not one the panel watches yet): anything else is a node whose servers are not known. */
export function nodeAway(node: NodeSeen): Away | null {
  if (node.state === "UNREACHABLE") return { reason: "unreachable", since: node.lastReachedAt };
  if (node.state === "DEGRADED") return { reason: "degraded", since: node.lastReachedAt };
  return null;
}

/** For a sentence with no clock in it (a page drawn on the server, which does not know the reader's time zone). */
export function awaySentence(nodeName: string, away: Away): string {
  return away.reason === "unreachable" ? `${nodeName} is unreachable` : `${nodeName} is not answering`;
}

/** What a control that cannot work says when it is disabled for this: the reason the reader gets on hover. */
export function awayReasonForControls(nodeName: string, away: Away): string {
  return `${awaySentence(nodeName, away)}, so its servers cannot be controlled from here until it answers again.`;
}
