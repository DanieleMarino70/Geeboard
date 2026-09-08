import "server-only";
import type { ServerState } from "@prisma/client";
import { db } from "./db";

/* ── Stand-in for the node daemon ────────────────────────────────
   A real deployment has an agent on each node that drives the
   container and reports the settled state back. Until that exists,
   transitional states would otherwise stick forever and the UI would
   look broken, so this flips them after a plausible delay.

   Deliberately in-process and deliberately named: it is a simulation,
   not a queue. Timers do not survive a server restart, so anything
   left mid-transition is settled on next read by `settleStale`. */

const TRANSITION_MS = {
  STARTING: 6000,
  STOPPING: 3500,
} as const;

const pending = new Map<string, NodeJS.Timeout>();

export function scheduleSettle(serverId: string, from: keyof typeof TRANSITION_MS, to: ServerState) {
  clearTimeout(pending.get(serverId));
  const timer = setTimeout(async () => {
    pending.delete(serverId);
    try {
      await db.server.updateMany({
        where: { id: serverId, state: from },
        data: {
          state: to,
          startedAt: to === "RUNNING" ? new Date() : null,
          playersOn: to === "RUNNING" ? 0 : 0,
          cpuPct: to === "RUNNING" ? 12 : 0,
          ramPct: to === "RUNNING" ? 28 : 0,
        },
      });
    } catch {
      // The simulator must never take the process down.
    }
  }, TRANSITION_MS[from]);

  timer.unref?.();
  pending.set(serverId, timer);
}

/* Settles anything a restart left stranded mid-transition. Cheap
   enough to call on any read of the server list. */
export async function settleStale() {
  const cutoff = new Date(Date.now() - 60_000);
  await db.server.updateMany({
    where: { state: "STARTING", updatedAt: { lt: cutoff } },
    data: { state: "RUNNING" },
  });
  await db.server.updateMany({
    where: { state: "STOPPING", updatedAt: { lt: cutoff } },
    data: { state: "STOPPED", startedAt: null, cpuPct: 0, ramPct: 0, playersOn: 0 },
  });
}
