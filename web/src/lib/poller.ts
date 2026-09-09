import "server-only";
import type { ServerState } from "@prisma/client";
import { AGENT_TO_DB, AgentError, agentFor } from "./daemon-client";
import { db } from "./db";

/* Reconciliation, not just metrics.

   The panel's idea of a server's state is only ever as good as its last
   look. A world can crash at 3am, or an operator can stop a container
   by hand on the node — neither goes through the panel, and without
   this the dashboard would keep insisting everything is fine.

   Each pass asks every reachable agent what is actually true, records
   the difference, and writes a metric sample while it is there. */

export interface PollReport {
  nodesChecked: number;
  nodesUnreachable: number;
  serversChecked: number;
  samplesWritten: number;
  driftCorrected: number;
  errors: string[];
}

/** Transitions worth telling someone about, and how to describe them. */
function driftEvent(from: ServerState, to: ServerState): { action: string; tone: "DANGER" | "WARNING" | "INFO" } | null {
  if (from === to) return null;

  // The server died without anyone asking it to.
  if (to === "CRASHED") return { action: "server.crashed", tone: "DANGER" };

  // It went down while the panel believed it was up.
  if (to === "STOPPED" && (from === "RUNNING" || from === "STARTING")) {
    return { action: "server.stopped.unexpectedly", tone: "WARNING" };
  }

  // It came back without the panel doing it — usually a restart policy.
  if (to === "RUNNING" && (from === "STOPPED" || from === "CRASHED")) {
    return { action: "server.recovered", tone: "INFO" };
  }

  // STARTING → RUNNING and STOPPING → STOPPED are the transitions the
  // panel already asked for; they are not news.
  return null;
}

export async function pollOnce(): Promise<PollReport> {
  const report: PollReport = {
    nodesChecked: 0,
    nodesUnreachable: 0,
    serversChecked: 0,
    samplesWritten: 0,
    driftCorrected: 0,
    errors: [],
  };

  const nodes = await db.node.findMany({
    where: { daemonUrl: { not: null }, daemonToken: { not: null } },
    include: { servers: { where: { containerId: { not: null } } } },
  });

  for (const node of nodes) {
    report.nodesChecked++;
    const agent = agentFor(node);
    if (!agent) continue;

    try {
      await agent.health();
    } catch (error) {
      report.nodesUnreachable++;
      report.errors.push(error instanceof AgentError ? error.message : `${node.name} unreachable`);

      // Say the node is unreachable rather than guessing at its servers:
      // the containers are probably fine, the panel just cannot see them.
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

    if (node.state === "UNREACHABLE") {
      await db.node.update({ where: { id: node.id }, data: { state: "HEALTHY" } });
      await db.activityEvent.create({
        data: { actor: "Watchdog", action: "node.recovered", target: node.name, tone: "SUCCESS" },
      });
    }

    for (const server of node.servers) {
      if (!server.containerId) continue;
      report.serversChecked++;

      try {
        const status = await agent.status(server.containerId);
        const actual = AGENT_TO_DB[status.state] as ServerState;

        const event = driftEvent(server.state, actual);
        if (event) {
          report.driftCorrected++;
          await db.activityEvent.create({
            data: {
              actor: "Watchdog",
              action: event.action,
              target: server.name,
              tone: event.tone,
              serverId: server.id,
              changes: { State: { from: server.state, to: actual } },
            },
          });
        }

        const running = actual === "RUNNING";
        let sample: Awaited<ReturnType<typeof agent.stats>> | null = null;
        if (running) {
          sample = await agent.stats(server.containerId);
          await db.metricSample.create({
            data: {
              serverId: server.id,
              cpuPct: Math.round(sample.cpuPct),
              ramMb: sample.memUsedMb,
              players: server.playersOn,
              // Tick rate comes from the game, not the container; until
              // something parses it out of the log, record the ceiling.
              tps: 20,
            },
          });
          report.samplesWritten++;
        }

        await db.server.update({
          where: { id: server.id },
          data: {
            state: actual,
            cpuPct: sample ? Math.min(100, Math.round(sample.cpuPct)) : 0,
            ramPct: sample ? Math.min(100, Math.round(sample.memPct)) : 0,
            startedAt: running ? (status.startedAt ? new Date(status.startedAt) : server.startedAt) : null,
            playersOn: running ? server.playersOn : 0,
          },
        });
      } catch (error) {
        const message = error instanceof AgentError ? error.message : `${server.name} check failed`;
        report.errors.push(message);
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
