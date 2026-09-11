import "server-only";
import { asPlatformError } from "@/domain/errors";
import { findGame } from "@/domain/games/registry";
import { portsFor } from "@/domain/games/types";
import { assessHealth } from "@/domain/nodes/health";
import { runtimeFor } from "@/domain/runtime/docker";
import type { RuntimeSample } from "@/domain/runtime/types";
import { assessServerHealth, type HealthReport } from "@/domain/servers/health";
import { decideRecovery, shouldForgiveAttempts } from "@/domain/servers/recovery";
import { LIVE, mapRuntimeState, reconcile } from "@/domain/servers/state";
import type { IGameRuntime, RuntimeRef } from "@/domain/runtime/types";
import type { Server } from "@prisma/client";
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
  healthChecked: number;
  unhealthy: number;
  /** Crashed servers the panel restarted this pass. */
  recovered: number;
  /** Crashed servers it stopped trying to restart. */
  gaveUp: number;
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
    healthChecked: 0,
    unhealthy: 0,
    recovered: 0,
    gaveUp: 0,
    errors: [],
  };

  const nodes = await db.node.findMany({
    where: {
      daemonUrl: { not: null },
      daemonToken: { not: null },
      // A node nobody has approved is not the watchdog's business.
      approvedAt: { not: null },
    },
    include: { servers: { where: { runtimeId: { not: null } } } },
  });

  for (const node of nodes) {
    report.nodesChecked++;
    const runtime = runtimeFor(node);
    if (!runtime) continue;

    let reachable = true;
    try {
      await runtime.ping();
    } catch (error) {
      reachable = false;
      report.nodesUnreachable++;
      report.errors.push(asPlatformError(error).message);
    }

    /* Health decays with silence rather than flipping on one failed
       request — a dropped packet, a restarting agent and a dead machine
       all look identical from here, and only one deserves an alarm.
       See domain/nodes/health.ts. */
    const health = assessHealth({
      current: node.state,
      lastSeenAt: node.lastSeenAt,
      reachable,
    });

    await db.node.update({
      where: { id: node.id },
      data: {
        ...(reachable ? { lastSeenAt: new Date() } : {}),
        ...(health.changed ? { state: health.state } : {}),
      },
    });

    if (health.event) {
      await db.activityEvent.create({
        data: {
          actor: "Watchdog",
          action: health.event.action,
          target: node.name,
          tone: health.event.tone,
          changes: { State: { from: node.state, to: health.state } },
        },
      });
    }

    /* Nothing more to ask of a node that did not answer. Its servers are
       probably fine; the panel simply cannot see them, and guessing at
       their state is how a dashboard starts lying. */
    if (!reachable) continue;

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
              // game query can ask for it, record the ceiling.
              tps: 20,
            },
          });
          report.samplesWritten++;
        }

        /* Is the game answering, as distinct from is the workload up?
           A running container is the thing an operator most wants to
           believe and the thing least worth believing. */
        const health = live ? await checkHealth(runtime, server, status.startedAt) : null;
        if (health) {
          report.healthChecked++;
          if (health.verdict === "unhealthy") report.unhealthy++;
        }

        /* A failing health check demotes a running server to UNHEALTHY.
           Booting and unknown do not: a server inside its boot grace is
           not broken, and a check that could not run is not evidence. */
        const state =
          health?.verdict === "unhealthy" && outcome.state === "RUNNING"
            ? ("UNHEALTHY" as const)
            : health?.verdict === "healthy" && outcome.state === "UNHEALTHY"
              ? ("RUNNING" as const)
              : outcome.state;

        if (state !== server.state && (state === "UNHEALTHY" || server.state === "UNHEALTHY")) {
          await db.activityEvent.create({
            data: {
              actor: "Watchdog",
              action: state === "UNHEALTHY" ? "server.unhealthy" : "server.healthy",
              target: server.name,
              tone: state === "UNHEALTHY" ? "WARNING" : "SUCCESS",
              serverId: server.id,
              changes: { Health: { from: server.state, to: state } },
            },
          });
        }

        /* A run that has lasted is evidence that whatever was wrong has
           stopped happening, so the crash budget is returned. Without
           this a server that falls over once a month would eventually
           exhaust it and stay down. */
        const definition = server.gameId ? findGame(server.gameId) : undefined;
        const forgiven = shouldForgiveAttempts(
          state,
          status.startedAt ? new Date(status.startedAt) : server.startedAt,
          server.restartAttempts,
          definition?.health.bootGraceSeconds,
        );

        const crashedNow = state === "CRASHED" && server.state !== "CRASHED";

        await db.server.update({
          where: { id: server.id },
          data: {
            state,
            cpuPct: sample ? Math.min(100, Math.round(sample.cpuPct)) : 0,
            ramPct: sample ? Math.min(100, Math.round(sample.memPct)) : 0,
            startedAt: live ? (status.startedAt ? new Date(status.startedAt) : server.startedAt) : null,
            playersOn: live ? server.playersOn : 0,
            ...(health ? { healthCheckedAt: new Date(), healthDetail: health.reason } : {}),
            ...(forgiven ? { restartAttempts: 0 } : {}),
            ...(crashedNow
              ? {
                  crashCount: { increment: 1 },
                  lastCrashAt: new Date(),
                  lastExitCode: status.exitCode,
                  oomKilled: status.oomKilled,
                }
              : {}),
          },
        });

        if (state === "CRASHED") {
          await recover(runtime, { ...server, state, restartAttempts: forgiven ? 0 : server.restartAttempts }, status, report);
        }
      } catch (error) {
        report.errors.push(asPlatformError(error).message);
      }
    }
  }

  return report;
}

/* Bringing a crashed server back, if its policy says so.

   The decision is the domain's — see servers/recovery.ts, where the
   ceiling, the backoff and the out-of-memory refusal live. This does
   the restarting, records the attempt, and stops when told to stop.

   Every outcome lands in the activity log, including the decision not
   to restart. A server that stays down because it exhausted its budget
   should say that, not simply sit there. */
async function recover(
  runtime: IGameRuntime,
  server: Server,
  status: { exitCode: number | null; oomKilled: boolean },
  report: PollReport,
) {
  const decision = decideRecovery({
    state: server.state,
    policy: server.restartPolicy,
    attempts: server.restartAttempts,
    maxRestarts: server.maxRestarts,
    lastRestartAt: server.lastRestartAt,
    exitCode: status.exitCode,
    oomKilled: status.oomKilled,
  });

  if (decision.action === "ignore" || decision.action === "wait") return;

  if (decision.action === "give-up") {
    report.gaveUp++;
    /* ERROR rather than CRASHED: the difference is that somebody has to
       look at it now, and a dashboard full of crashed servers that are
       quietly being retried reads differently from one showing a server
       that has given up. */
    await db.server.update({
      where: { id: server.id },
      data: { state: "ERROR", lastError: decision.reason },
    });
    await db.activityEvent.create({
      data: {
        actor: "Watchdog",
        action: "server.recovery.abandoned",
        target: server.name,
        tone: "DANGER",
        serverId: server.id,
        changes: { Reason: { from: "—", to: decision.reason } },
      },
    });
    return;
  }

  const ref: RuntimeRef = { serverId: server.id, runtimeId: server.runtimeId };
  try {
    await runtime.start(ref);
    report.recovered++;

    await db.server.update({
      where: { id: server.id },
      data: {
        state: "STARTING",
        restartAttempts: decision.attempt,
        lastRestartAt: new Date(),
        startedAt: new Date(),
      },
    });
    await db.activityEvent.create({
      data: {
        actor: "Watchdog",
        action: "server.recovered",
        target: server.name,
        tone: "INFO",
        serverId: server.id,
        changes: { Attempt: { from: "—", to: `${decision.attempt} of ${server.maxRestarts}` } },
      },
    });
  } catch (error) {
    /* The attempt still counts. A restart that will not even start is
       exactly the case the ceiling exists for, and not counting it
       would mean retrying forever. */
    report.errors.push(asPlatformError(error).message);
    await db.server.update({
      where: { id: server.id },
      data: { restartAttempts: decision.attempt, lastRestartAt: new Date() },
    });
  }
}

/* Asks the game's own probes whether it is answering.

   The evidence is gathered here and judged in the domain, which is what
   keeps the arithmetic testable without a node. Which probes to run is
   the definition's decision; what a TCP connect costs is the node's.

   Gathering must never fail the pass. A node that stops answering
   mid-check is a node problem, and turning it into "your server is
   unhealthy" would be a lie told confidently. */
async function checkHealth(
  runtime: IGameRuntime,
  server: Server,
  startedAt: string | null,
): Promise<HealthReport | null> {
  const game = server.gameId ? findGame(server.gameId) : undefined;
  if (!game || !server.runtimeId) return null;

  const ref: RuntimeRef = { serverId: server.id, runtimeId: server.runtimeId };
  const ports: Record<string, boolean | null> = {};

  // Only the ports this game's probes actually name — there is no reason
  // to knock on RCON to find out whether players can connect.
  const wanted = new Set(
    game.health.probes.flatMap((p) => (p.kind === "port" ? [p.port] : [])),
  );
  if (wanted.size > 0) {
    const allocated = portsFor(game, server.port);
    for (const id of wanted) {
      const port = allocated.find((p) => p.id === id);
      if (!port) {
        ports[id] = null;
        continue;
      }
      ports[id] = await runtime.probePort(ref, port.host).catch(() => null);
    }
  }

  const needsLogs = game.health.probes.some((p) => p.kind === "log") || game.health.crashPattern;
  const logLines = needsLogs
    ? await runtime
        .logs(ref, 120)
        .then((lines) => lines.map((l) => l.line))
        .catch(() => [])
    : [];

  return assessServerHealth(game, {
    running: true,
    startedAt: startedAt ? new Date(startedAt) : server.startedAt,
    ports,
    logLines,
  });
}

/** Samples older than the window are of no use to any chart the panel draws. */
export async function pruneSamples(days = 30): Promise<number> {
  const { count } = await db.metricSample.deleteMany({
    where: { at: { lt: new Date(Date.now() - days * 24 * 3600_000) } },
  });
  return count;
}
