import type { ServerState } from "@prisma/client";

/* A create the panel did not live to finish.

   Creating a server is one long request. While it runs the row says
   INSTALLING and is written again every time the installer reports — every
   second and a half during a download, and a download whose node stops
   answering fails on its own after three minutes — so a create that is alive
   never goes quiet for long. If the panel is stopped in the middle, nothing
   will ever write that row again: the poller reads only servers that already
   have a workload, and the simulator's sweep is for servers that have no agent
   at all. The page said "Installing" for ever, with nothing to do about it.

   So a server that has been CREATING or INSTALLING and quiet for ten minutes —
   more than three times the longest silence a live create can have — is one
   nobody is creating. It becomes an error that says so and what to do, and is
   never deleted for anybody: the node may hold part of it, and deleting the
   server is what clears that. */

export const CREATE_SILENT_MS = 10 * 60_000;

export const CREATING_STATES: readonly ServerState[] = ["CREATING", "INSTALLING"];

export function createInterrupted(facts: { state: ServerState; updatedAt: Date }, nowMs: number): boolean {
  return CREATING_STATES.includes(facts.state) && nowMs - facts.updatedAt.getTime() > CREATE_SILENT_MS;
}

const DOING: Record<string, string> = {
  prepare: "preparing it",
  download: "downloading its build",
  provision: "creating it on the node",
  configure: "writing its settings",
  start: "starting it",
};

/* One sentence for the server's page, the audit log and the API. It says
   where the create had got to, because that tells whether the node holds
   anything, and how to get out of it. */
export function interruptionMessage(step: string | null): string {
  const doing = step ? DOING[step] : undefined;
  return `The panel stopped while this server was being created${doing ? `, which was ${doing}` : ""}. The node may hold part of it. Delete it from its Settings page — that clears whatever was left on the node — and create it again.`;
}
