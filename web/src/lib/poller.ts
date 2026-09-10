import "server-only";
import { asPlatformError } from "@/domain/errors";
import { runtimeFor } from "@/domain/runtime/docker";
import type { RuntimeSample } from "@/domain/runtime/types";
import { LIVE, mapRuntimeState, reconcile } from "@/domain/servers/state";
import { db } from "./db";

/* Reconciliation, not just metrics.

   The panel's idea of a server's state is only ever as good as its last
   look. A world can crash at 3am, or an operator can stop a server by
   hand on the node — neither goes through the panel, and without this
   the dashboard would keep insisting everything is fine.

   Each pass asks every reachable node what is actually true, records the
   difference, and writes a metric sample while it is there. What counts
   as a difference worth reporting — and when the node's answer should be
   ignored in favour of what the panel is in the middle of doing — is
   src/domain/servers/state.ts's decision, not this file's. */

export interface PollReport {
  nodesChecked: number;
  nodesUnreachable: number;
  serversChecked: number;
  samplesWritten: number;
  driftCorrected: number;
  /** Observations ignored because the panel was mid-operation. */
  held: number;
  errors: string[];
}

export async function pollOnce(): Promise<PollReport> {
  const report: PollReport = {
    nodesChecked: 0,
    nodesUnreachable: 0,
    serversChecked: 0,
    samplesWritten: 0,
    driftCorrected: 0,
    held: 0,
    errors: [],
  };

  const nodes = await db.node.findMany({
    where: { daemonUrl: { not: null }, daemonToken: { not: null } },
    include: { servers: { where: { runtimeId: { not: null } } } },
  });

  for (const node of nodes) {
    report.nodesChecked++;
    const runtime = runtimeFor(node);
    if (!runtime) continue;

    try {
      await runtime.ping();
    } catch (error) {
      report.nodesUnreachable++;
      report.errors.push(asPlatformError(error).message);

      // Say the node is unreachable rather than guessing at its servers:
      // they are probably fine, the panel just cannot see them.
      if (node.state !== "UNREACHABLE") {
        await db.node.update({ where: { id: node.id }, data: { state: "UNREACHABLE" } });
        await db.activityEvent.create({
          data: {
            actor: "Watchdog",
            action: "node.unreachable",
            target: node.name,
            tone: "DANGER",
          },
        });
      }
      continue;
    }

    /* Heard from. A node under maintenance stays under maintenance —
       that is an operator's decision, not something a successful ping
       gets to overrule. */
    const recovered = node.state === "UNREACHABLE";
    await db.node.update({
      where: { id: node.id },
      data: {
        lastSeenAt: new Date(),
        ...(recovered ? { state: "HEALTHY" as const } : {}),
      },
    });
    if (recovered) {
      await db.activityEvent.create({
        data: { actor: "Watchdog", action: "node.recovered", target: node.name, tone: "SUCCESS" },
      });
    }

    for (const server of node.servers) {
      if (!server.runtimeId) continue;
      report.serversChecked++;
      const ref = { serverId: server.id, runtimeId: server.runtimeId };

      try {
        const status = await runtime.status(ref);
        const observed = mapRuntimeState(status.state);
        const outcome = reconcile(server.state, observed);

        if (outcome.held) {
          report.held++;
          continue;
        }

        if (outcome.event) {
          report.driftCorrected++;
          await db.activityEvent.create({
            data: {
              actor: "Watchdog",
              action: outcome.event.action,
              target: server.name,
              tone: outcome.event.tone,
              serverId: server.id,
              changes: { State: { from: server.state, to: outcome.state } },
            },
          });
        }

        const live = LIVE.has(outcome.state);
        let sample: RuntimeSample | null = null;
        if (live) {
          sample = await runtime.sample(ref);
          await db.metricSample.create({
            data: {
              serverId: server.id,
              cpuPct: Math.round(sample.cpuPct),
              ramMb: sample.memUsedMb,
              players: server.playersOn,
              // Tick rate comes from the game, not the runtime; until a
              // game-aware health check parses it out, record the ceiling.
              tps: 20,
            },
          });
          report.samplesWritten++;
        }

        await db.server.update({
          where: { id: server.id },
          data: {
            state: outcome.state,
            cpuPct: sample ? Math.min(100, Math.round(sample.cpuPct)) : 0,
            ramPct: sample ? Math.min(100, Math.round(sample.memPct)) : 0,
            startedAt: live ? (status.startedAt ? new Date(status.startedAt) : server.startedAt) : null,
            playersOn: live ? server.playersOn : 0,
          },
        });
      } catch (error) {
        report.errors.push(asPlatformError(error).message);
      }
    }
  }

  return report;
}

/** Samples older than the window are of no use to any chart the panel draws. */
export async function pruneSamples(days = 30): Promise<number> {
  const { count } = await db.metricSample.deleteMany({
    where: { at: { lt: new Date(Date.now() - days * 24 * 3600_000) } },
  });
  return count;
}
