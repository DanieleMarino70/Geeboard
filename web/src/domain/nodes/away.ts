/* A node the panel cannot see, and what a page should do about it.

   A node is called degraded after thirty seconds of silence and unreachable after two minutes (domain/nodes/health.ts), and the poller then
   skips it: its servers keep the last state and the last player count they had, so the dashboard showed a green "Running" and "12 / 40" on a
   machine that had been gone for an hour, and the pages that ask the node something while they draw (the console's backlog, the settings'
   files on the node) waited ten seconds, and twenty for a game with two files, for an answer from one that was not going to give it. Here is
   the one place that says whether a node is away; the pages, the server rows and the reads all ask it. Pure. */

import { UNREACHABLE_AFTER_MS } from "./health";

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

/* A node the panel has not reached for longer than it takes to be called unreachable, whatever state a person put it in. A node that was
   drained and then died stays "draining" (silence does not deepen a state somebody chose: domain/nodes/health.ts), so the state alone does not
   say it is gone, and the page that offers to forget a server on it has to ask the clock too. Only a hint for the page: the operation asks the
   node itself, at the moment, and refuses a forget if it answers. */
export function nodeSilent(node: NodeSeen, now: Date = new Date()): boolean {
  if (node.state === "UNREACHABLE") return true;
  if (node.state !== "DRAINING" && node.state !== "MAINTENANCE") return false;
  return node.lastReachedAt === null || now.getTime() - node.lastReachedAt.getTime() > UNREACHABLE_AFTER_MS;
}

/** For a sentence with no clock in it (a page drawn on the server, which does not know the reader's time zone). */
export function awaySentence(nodeName: string, away: Away): string {
  return away.reason === "unreachable" ? `${nodeName} is unreachable` : `${nodeName} is not answering`;
}

/** What a control that cannot work says when it is disabled for this: the reason the reader gets on hover. */
export function awayReasonForControls(nodeName: string, away: Away): string {
  return `${awaySentence(nodeName, away)}, so its servers cannot be controlled from here until it answers again.`;
}
