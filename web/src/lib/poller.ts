import "server-only";
import { gate, mapPool, withDeadline } from "@/domain/concurrency";
import { bare, sentences } from "@/domain/text";
import { SECRETS_KEY_SENTENCE, SecretsKeyError, asPlatformError } from "@/domain/errors";
import { findGame } from "@/domain/games/registry";
import { portsFor } from "@/domain/games/types";
import { assessHealth } from "@/domain/nodes/health";
import { runtimeFor } from "@/domain/runtime/docker";
import type { ClientOptions } from "./daemon-client";
import type { RuntimeSample } from "@/domain/runtime/types";
import { currentConfig } from "@/domain/games/config";
import {
  assessServerHealth,
  becameReady,
  knownFailure,
  queryApplies,
  type HealthEvidence,
  type HealthReport,
} from "@/domain/servers/health";
import { judgeQueryReply, queryPlan, type ExchangeEnd, type QueryVerdict } from "@/domain/servers/query";
import { networkDelta } from "@/domain/servers/network";
import { advanceCursor, playerEvents, readFrom, unreadLines } from "@/domain/servers/players";
import { STOP_PENDING, decideAfterStop, decideRecovery, leftStoppedReason, shouldForgiveAttempts, stopEvidence, type StopEvidence } from "@/domain/servers/recovery";
import { LIVE, endsThePass, mapRuntimeState, reconcile, workloadMissing } from "@/domain/servers/state";
import { worldSizeDue } from "@/domain/servers/stagger";
import type { IGameRuntime, RuntimeRef } from "@/domain/runtime/types";
import { Prisma, type Server } from "@prisma/client";
import { CREATE_SILENT_MS, CREATING_STATES, interruptionMessage } from "@/domain/servers/interrupted";
import { refreshCommunityGames } from "./community-games";
import { db } from "./db";
import { reconcileDns } from "./dns-ops";
import { logger } from "./log";

type Gate = ReturnType<typeof gate>;

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
  /** Servers whose workload was found removed outside the panel this pass. */
  workloadsMissing: number;
  /** Creates nobody was finishing, turned into errors this pass. */
  interruptedCreates: number;
  /** DNS records written this pass, and tries that failed. Zero with no provider. */
  dnsSynced: number;
  dnsFailed: number;
  /** Servers whose records were left for the next try because the provider could not be asked at all. */
  dnsDeferred: number;
  /** Nodes whose token the panel cannot open with the SECRETS_KEY it has: they are treated as not reached, and the others are looked at as always. */
  nodesUnreadable: string[];
  /** Nodes left alone this pass because the look at them in an earlier one had not ended. */
  nodesSkipped: string[];
  /** The node that took longest this pass and how long it took: the pass is as long as it is. */
  slowestNode: { name: string; ms: number } | null;
  errors: string[];
}

/* How the pass is spread. The nodes are looked at together and the servers of one node four at a time, and every server's work goes through
   one gate so that the connections to the database (ten in this process) are not asked for by more than can use them. A call to a node that
   names no time of its own gives up after five seconds, where a page waits ten: a node that does not answer costs a pass five seconds in
   parallel with the rest, and not ten in front of them. A node that has not finished within the deadline is left to finish, by its calls' own
   limits, and is not asked about again until it has: it is a slow node, not a queue. */
export interface PollOptions {
  /** Servers being read at once, over all nodes. */
  concurrency?: number;
  /** How long a node may hold the pass. */
  nodeDeadlineMs?: number;
  /** The limit of a call to a node that does not name its own. */
  callTimeoutMs?: number;
}

const numberFrom = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
};

const SERVERS_PER_NODE = 4;
const NODES_AT_ONCE = 16;

/** Nodes whose look in an earlier pass has not ended, by id. */
const inFlight = new Map<string, Promise<void>>();

type PolledNode = Awaited<ReturnType<typeof loadNodes>>[number];

const loadNodes = () =>
  db.node.findMany({
    where: {
      daemonUrl: { not: null },
      daemonToken: { not: null },
      // A node nobody has approved is not the watchdog's business.
      approvedAt: { not: null },
    },
    include: { servers: { where: { runtimeId: { not: null } } } },
  });

export async function pollOnce(options: PollOptions = {}): Promise<PollReport> {
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
    workloadsMissing: 0,
    interruptedCreates: 0,
    dnsSynced: 0,
    dnsFailed: 0,
    dnsDeferred: 0,
    nodesUnreadable: [],
    nodesSkipped: [],
    slowestNode: null,
    errors: [],
  };
  const concurrency = options.concurrency ?? numberFrom(process.env.POLL_CONCURRENCY, 8);
  const deadlineMs = options.nodeDeadlineMs ?? numberFrom(process.env.POLL_NODE_DEADLINE_MS, 45_000);
  const calls: ClientOptions = { timeoutMs: options.callTimeoutMs ?? numberFrom(process.env.POLL_CALL_TIMEOUT_MS, 5_000) };

  /* The games an owner approved from a manifest, read here because this is its own process and the registry is in
     memory: what a server is told about its game on this pass is the game as it is now. */
  try {
    await refreshCommunityGames();
  } catch (error) {
    report.errors.push(`community games: ${asPlatformError(error).message}`);
  }

  const nodes = await loadNodes();
  const through = gate(concurrency);

  await mapPool(nodes, NODES_AT_ONCE, async (node) => {
    if (inFlight.has(node.id)) {
      report.nodesSkipped.push(node.name);
      report.errors.push(`${node.name}: the last look at it has not ended, so this pass leaves it alone`);
      return;
    }
    const began = performance.now();
    const work = pollNode(node, report, through, calls).catch((error: unknown) => {
      // Nothing a node does ends the pass: what it could not do is its own line, with its name.
      report.errors.push(`${node.name}: ${error instanceof Error ? error.message : String(error)}`);
    });
    const tracked = work.finally(() => inFlight.delete(node.id));
    inFlight.set(node.id, tracked);
    const outcome = await withDeadline(tracked.then(() => "ended" as const), deadlineMs, () => "late" as const);
    const ms = Math.round(performance.now() - began);
    if (!report.slowestNode || ms > report.slowestNode.ms) report.slowestNode = { name: node.name, ms };
    if (outcome === "late") report.errors.push(`${node.name}: still being read after ${Math.round(deadlineMs / 1000)} s; the pass goes on without it, and it is not asked again until it has answered`);
  });

  /* A create the panel was stopped in the middle of: nothing above reads a
     server that has no workload yet, so it would be "Installing" for ever. */
  try {
    report.interruptedCreates = await sweepInterruptedCreates();
  } catch (error) {
    report.errors.push(`interrupted creates: ${asPlatformError(error).message}`);
  }

  /* DNS records that no longer say their node's address, or failed a
     while ago: the retry the lifecycle hooks promise. One query and no
     call when there is nothing to do, and nothing at all without a
     provider. */
  try {
    const dns = await reconcileDns();
    report.dnsSynced = dns.synced;
    report.dnsFailed = dns.failed;
    report.dnsDeferred = dns.deferred;
  } catch (error) {
    report.errors.push(`dns: ${asPlatformError(error).message}`);
  }

  return report;
}

/* One node: is it there, what does it say about itself, and then each of its servers. */
async function pollNode(node: PolledNode, report: PollReport, through: Gate, calls: ClientOptions): Promise<void> {
  report.nodesChecked++;

  /* Opening the node's token is the first thing that can fail, and it used to be outside every try: a token the key does not open ended
     the whole pass (the nodes after it were never looked at, nor the scheduled tasks, nor the notifications) with one line that named no
     node. It is now this node's failure: not reached, said with its name and the reason, and the pass goes on. */
  let runtime: ReturnType<typeof runtimeFor>;
  let reachable = true;
  /* The round trip of this check is the only latency the panel can
     honestly report: panel to agent, not player to server. It was
     never measured, so every registered node showed 0 ms. */
  let pingMs: number | null = null;
  let why: string | null = null;
  let detail: string | null = null;
  try {
    runtime = runtimeFor(node, calls);
  } catch (error) {
    runtime = null;
    reachable = false;
    report.nodesUnreachable++;
    if (error instanceof SecretsKeyError) {
      // Said once per change by the process that runs the passes, with every node's name: not a line in each of them.
      report.nodesUnreadable.push(node.name);
      why = `its token cannot be opened: ${SECRETS_KEY_SENTENCE}`;
    } else {
      why = `its token cannot be opened (${error instanceof Error ? error.message : String(error)})`;
      report.errors.push(`${node.name}: ${why}`);
    }
    detail = `${node.name}: ${why}`;
  }
  if (reachable && !runtime) return;

  if (runtime) {
    try {
      const sent = performance.now();
      await runtime.ping();
      pingMs = Math.max(1, Math.round(performance.now() - sent));
    } catch (error) {
      reachable = false;
      report.nodesUnreachable++;
      /* The sentence names the node and the address and says what the network said (domain/runtime/reach.ts): it is the page's too, and
         no longer "http://203.0.113.10:8080 fra-node-02 is unreachable." here and the same fault worded another way from the heartbeat. */
      why = asPlatformError(error, `pinging ${node.name}`).message;
      detail = sentences(why);
      report.errors.push(why);
    }
  }

  /* Health decays with silence rather than flipping on one failed
     request — a dropped packet, a restarting agent and a dead machine
     all look identical from here, and only one deserves an alarm.
     See domain/nodes/health.ts. */
  const health = assessHealth({
    current: node.state,
    lastReachedAt: node.lastReachedAt,
    reachable,
  });

  /* What the node last reported about itself, kept for its page's history. Only from a pass
     that reached it: a node that did not answer has nothing new to say, and its last values
     written again would be a flat line drawn through its silence. */
  if (reachable) {
    await db.nodeSample.create({ data: { nodeId: node.id, cpuPct: node.cpuPct, ramPct: node.ramPct, diskPct: node.diskPct, pingMs: pingMs ?? node.pingMs } });
  }

  await db.node.update({
    where: { id: node.id },
    data: {
      /* Both, and they mean different things: heard from at all, and
         reached on its own address. Health decays from the second. */
      ...(reachable ? { lastSeenAt: new Date(), lastReachedAt: new Date() } : {}),
      // Why not, in the words the call failed with, so a page can say it; cleared by a call that gets through.
      reachDetail: reachable ? null : (detail ?? `${node.daemonUrl} could not be reached.`),
      ...(pingMs !== null ? { pingMs } : {}),
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
  if (!reachable || !runtime) return;

  const unrequested: Unrequested[] = [];
  const context: ServerContext = { runtime, node, report, unrequested };
  await mapPool(
    node.servers.filter((s) => s.runtimeId),
    SERVERS_PER_NODE,
    (server) => through(() => pollServer(context, server)),
  );

  /* Now that the whole node has been read, what stopped together is known, and so is what to do about each. */
  try {
    for (const stop of unrequested) {
      if (stop.server.restartPolicy !== "ALWAYS") continue;
      await recoverAfterStop(runtime, { ...stop.server, state: "STOPPED" }, stopEvidence(stop.exitCode, unrequested.length), report);
    }
    await reportLeftStopped(node.name, unrequested);
  } catch (error) {
    report.errors.push(`${node.name}: stopped servers not dealt with (${asPlatformError(error).message})`);
  }
}

/* One reading of a server whose backup holds its state: a sample, and the counters the next difference is taken against, so that what went
   over the network in the backup is counted in it and not again in the first sample after. Written only while the server is still BACKING_UP. */
async function recordWhileBackingUp(runtime: IGameRuntime, ref: RuntimeRef, server: Server, startedAt: string | null, report: PollReport): Promise<void> {
  try {
    const sample = await runtime.sample(ref);
    if (sample.measured === false) return;
    const runStartedAt = startedAt ? new Date(startedAt) : null;
    const net = networkDelta({ rx: server.netRx, tx: server.netTx, startedAt: server.netStartedAt }, { rx: sample.rxBytes, tx: sample.txBytes, startedAt: runStartedAt });
    const moved = await db.server.updateMany({
      where: { id: server.id, state: "BACKING_UP" },
      data: {
        cpuPct: Math.min(100, Math.round(sample.cpuPct)),
        ramPct: Math.min(100, Math.round(sample.memPct)),
        netRx: BigInt(Math.round(sample.rxBytes)),
        netTx: BigInt(Math.round(sample.txBytes)),
        netStartedAt: runStartedAt,
      },
    });
    if (moved.count !== 1) return;
    await db.metricSample.create({
      data: {
        serverId: server.id,
        cpuPct: Math.round(sample.cpuPct),
        ramMb: sample.memUsedMb,
        players: server.playersOn,
        rxBytes: net ? BigInt(net.rx) : null,
        txBytes: net ? BigInt(net.tx) : null,
        diskBytes: server.worldSizeBytes,
      },
    });
    report.samplesWritten++;
  } catch (error) {
    report.errors.push(`${server.name}: not read while its backup runs (${asPlatformError(error).message})`);
  }
}

interface ServerContext {
  runtime: NonNullable<ReturnType<typeof runtimeFor>>;
  node: PolledNode;
  report: PollReport;
  /** The servers of this node found stopped, filled as they are read and acted on when all have been. */
  unrequested: Unrequested[];
}

async function pollServer(context: ServerContext, server: Server): Promise<void> {
  const { runtime, node, report, unrequested } = context;
  if (!server.runtimeId) return;
  report.serversChecked++;
  const ref = { serverId: server.id, runtimeId: server.runtimeId };

  try {
    const status = await runtime.status(ref);
    const observed = mapRuntimeState(status.state);
    const outcome = reconcile(server.state, observed);

    // An unhealthy server is held and still goes on to its health check.
    if (endsThePass(outcome)) {
      report.held++;
      /* A backup holds the server's state and not its workload, which goes on running and is the busiest it will be all day. It is still
         read, for the charts: a nightly backup of a large world was a flat gap in every graph of the server being backed up, as long as
         the backup, and the answer to "did the backup slow the game down" was in the one stretch that was not drawn. Only the reading:
         the state, the health and the players are the backup's to leave alone. */
      if (server.state === "BACKING_UP" && LIVE.has(observed)) await recordWhileBackingUp(runtime, ref, server, status.startedAt, report);
      return;
    }

    const live = LIVE.has(outcome.state);
    const definition = server.gameId ? findGame(server.gameId) : undefined;

    let known: string | null = null;
    if (outcome.event) {
      report.driftCorrected++;
      /* A server that stopped by itself says why when its game has
         told us: the console of a Terraria server whose world would not
         load ends in a stack trace and an exit code of 0, and the page
         said "Stopped" and nothing else. */
      const why =
        !live && definition?.health.failures?.length
          ? await runtime
              .logs(ref, 120)
              .then((lines) => knownFailure(definition, lines.map((l) => l.line)))
              .catch(() => null)
          : null;
      known = why;
      if (why) await db.server.update({ where: { id: server.id }, data: { lastError: why } });
      await db.activityEvent.create({
        data: {
          actor: "Watchdog",
          action: outcome.event.action,
          target: server.name,
          tone: outcome.event.tone,
          serverId: server.id,
          changes: {
            State: { from: server.state, to: outcome.state },
            ...(why ? { Reason: { from: "—", to: why } } : {}),
          },
        },
      });
    }

    /* Who is connected, from what the console said since the last
       look. A failure here costs this pass's count and nothing else —
       it must not stop the state or the metrics being recorded. */
    let players: { online: number; cursor: Date | null } | null = null;
    if (live && definition?.console.players) {
      players = await readPlayers(runtime, ref, server, definition.console, status.startedAt).catch(
        (error: unknown) => {
          report.errors.push(`${server.name}: players not read (${asPlatformError(error).message})`);
          return null;
        },
      );
    } else if (!live && (server.playersOn > 0 || outcome.event)) {
      /* Nobody is connected to a server that is not running. Asked of the database once, when it stopped or when somebody was counted on it:
         it was a query for every stopped server on every pass. */
      await closeSessions(server.id, new Date());
    }
    const playersOn = live ? (players?.online ?? server.playersOn) : 0;

    let sample: RuntimeSample | null = null;
    if (live) {
      sample = await runtime.sample(ref);
    }
    /* A workload read in its first moments has nothing measured yet.
       Writing that down as 0 MB put a dip to nothing on every chart
       after every start; the row keeps its last reading instead. */
    const measured = sample !== null && sample.measured !== false;
    const runStartedAt = status.startedAt ? new Date(status.startedAt) : null;
    if (sample && measured) {
      /* What went over the network since the last sample, and the size of the world as last
         measured. The counters Docker keeps start again with the container, so a difference is
         taken with that rule (domain/servers/network.ts); the first sample of a run has none. */
      const net = networkDelta({ rx: server.netRx, tx: server.netTx, startedAt: server.netStartedAt }, { rx: sample.rxBytes, tx: sample.txBytes, startedAt: runStartedAt });
      await db.metricSample.create({
        data: {
          serverId: server.id,
          cpuPct: Math.round(sample.cpuPct),
          ramMb: sample.memUsedMb,
          players: playersOn,
          rxBytes: net ? BigInt(net.rx) : null,
          txBytes: net ? BigInt(net.tx) : null,
          diskBytes: server.worldSizeBytes,
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
    const forgiven = shouldForgiveAttempts(
      state,
      status.startedAt ? new Date(status.startedAt) : server.startedAt,
      server.restartAttempts,
      definition?.health.bootGraceSeconds,
    );

    const crashedNow = state === "CRASHED" && server.state !== "CRASHED";

    /* Written only if the server is still in the state this pass read it in. The list of servers is read at the start of the pass and a node
       is asked about them one after another, so a minute may have passed: a backup, an update or a Stop pressed in it had already moved the
       server on, and writing the state of before over it left the platform's own state (Backing up, Updating) wiped and the server unclaimed. */
    const { count } = await db.server.updateMany({
      where: { id: server.id, state: server.state },
      data: {
        state,
        cpuPct: !live ? 0 : measured ? Math.min(100, Math.round(sample!.cpuPct)) : server.cpuPct,
        ramPct: !live ? 0 : measured ? Math.min(100, Math.round(sample!.memPct)) : server.ramPct,
        startedAt: live ? (status.startedAt ? new Date(status.startedAt) : server.startedAt) : null,
        playersOn,
        /* The counters to take the next difference against: this reading, for a run that is going on;
           nothing for a server that is not running, so the next run starts from no base. */
        ...(!live ? { netRx: null, netTx: null, netStartedAt: null } : measured ? { netRx: BigInt(Math.round(sample!.rxBytes)), netTx: BigInt(Math.round(sample!.txBytes)), netStartedAt: runStartedAt } : {}),
        ...(players ? { logCursorAt: players.cursor } : {}),
        ...(health ? { healthCheckedAt: new Date(), healthDetail: health.reason } : {}),
        ...(health?.readyAt ? { readyAt: health.readyAt } : {}),
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
    if (count !== 1) {
      report.held++;
      return;
    }

    if (state === "CRASHED") {
      await recover(runtime, { ...server, state, restartAttempts: forgiven ? 0 : server.restartAttempts }, status, report);
    }

    /* A server that stopped without the panel having stopped it — the machine rebooted, Docker restarted, the game
       quit — and one that did and is waiting its turn to be started again. The first is seen once, as the drift; the
       second carries a marker in its last error, because "stopped" is a state nothing re-examines. A policy that
       starts it again does so now; one that does not is reported when the node has been read. */
    const stoppedUnexpectedly = outcome.event?.action === "server.stopped.unexpectedly";
    const waitingForRestart =
      state === "STOPPED" && server.state === "STOPPED" && server.restartPolicy === "ALWAYS" && (server.lastError ?? "").startsWith(STOP_PENDING);
    if (stoppedUnexpectedly) unrequested.push({ server, exitCode: status.exitCode, known });
    if (waitingForRestart) await recoverAfterStop(runtime, { ...server, state }, "none", report);

    /* The size of its world, now and then, and beside the pass: walking a directory of a large world takes seconds, and a pass that waited
       for it waited for every world in turn. */
    startWorldMeasure(runtime, ref, server, node.name);
  } catch (error) {
    const failure = asPlatformError(error, `reading ${server.name} on ${node.name}`);
    /* The node answered, and the workload is not there. Said once,
       as ERROR, rather than as this error line on every pass forever. */
    if (failure.code === "NOT_FOUND" && (await recordMissingWorkload(server, node.name))) {
      report.workloadsMissing++;
      return;
    }
    // With the server: the line used to say what had failed and not for which.
    report.errors.push(`${server.name}: ${failure.message}`);
  }
}

/* ── Creates that were interrupted ────────────────────────────────── */

/* See domain/servers/interrupted.ts for why ten minutes and why an error and
   not a delete. The write is guarded by the same state and age as the read,
   so a create that wrote its row a moment ago — slow, not stopped — is left
   as it is, and so is one another pass has already dealt with. */
export async function sweepInterruptedCreates(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CREATE_SILENT_MS);
  const quiet = await db.server.findMany({
    where: { state: { in: [...CREATING_STATES] }, updatedAt: { lt: cutoff } },
    select: { id: true, name: true, state: true, installStep: true },
  });

  let changed = 0;
  for (const server of quiet) {
    const { count } = await db.server.updateMany({
      where: { id: server.id, state: server.state, updatedAt: { lt: cutoff } },
      data: {
        state: "ERROR",
        lastError: interruptionMessage(server.installStep),
        installKey: null,
        installStep: null,
        installMessage: null,
        installDetail: Prisma.DbNull,
      },
    });
    if (count !== 1) continue;
    changed++;
    await db.activityEvent.create({
      data: {
        actor: "Watchdog",
        action: "server.create.interrupted",
        target: server.name,
        tone: "WARNING",
        serverId: server.id,
        changes: { State: { from: server.state, to: "ERROR" }, Step: { from: server.installStep ?? "—", to: "interrupted" } },
      },
    });
  }
  return changed;
}

/* ── Players ──────────────────────────────────────────────────────── */

/* Reads the console since the last look and applies what it says.

   Sessions are rows, so a player's history outlives the run they played
   in. A new run of the server closes whatever the last one left open:
   the container restarted, so everyone connected to it went with it. */
async function readPlayers(
  runtime: IGameRuntime,
  ref: RuntimeRef,
  server: Server,
  dialect: NonNullable<ReturnType<typeof findGame>>["console"],
  startedAt: string | null,
): Promise<{ online: number; cursor: Date | null }> {
  const runStartedAt = startedAt ? new Date(startedAt) : server.startedAt;
  if (runStartedAt) await closeSessions(server.id, runStartedAt, runStartedAt);

  const from = readFrom(server.logCursorAt, runStartedAt);
  const cursor = server.logCursorAt && from && server.logCursorAt >= from ? server.logCursorAt : null;
  const lines = await runtime.logs(ref, 2000, from ?? undefined);
  const fresh = unreadLines(lines, cursor);

  /* Every line read goes in, so a connection announced before the cursor
     and named after it is still paired; only what is after the cursor
     becomes an event. */
  for (const event of playerEvents(dialect, lines, cursor)) {
    const open = await db.playerSession.findFirst({
      where: { serverId: server.id, username: event.name, online: true },
      orderBy: { joinedAt: "desc" },
    });
    if (event.kind === "join") {
      if (!open) {
        await db.playerSession.create({
          // The game's connection id, where it has one, is what a leave names.
          data: { serverId: server.id, username: event.name, uuid: event.id ?? "", online: true, joinedAt: event.at },
        });
      }
    } else if (open) {
      await db.playerSession.update({
        where: { id: open.id },
        data: {
          online: false,
          leftAt: event.at,
          playtimeM: Math.max(0, Math.round((event.at.getTime() - open.joinedAt.getTime()) / 60_000)),
        },
      });
    }
  }

  const online = await db.playerSession.count({ where: { serverId: server.id, online: true } });
  return { online, cursor: advanceCursor(fresh, cursor ?? from) };
}

/** Ends open sessions: all of them, or only those that began before a time. */
async function closeSessions(serverId: string, at: Date, joinedBefore?: Date) {
  const open = await db.playerSession.findMany({
    where: { serverId, online: true, ...(joinedBefore ? { joinedAt: { lt: joinedBefore } } : {}) },
  });
  for (const session of open) {
    await db.playerSession.update({
      where: { id: session.id },
      data: {
        online: false,
        leftAt: at,
        playtimeM: Math.max(0, Math.round((at.getTime() - session.joinedAt.getTime()) / 60_000)),
      },
    });
  }
}

/* ── World size ───────────────────────────────────────────────────── */

export const WORLD_SIZE_EVERY_MS = 5 * 60_000;

/* Measured beside the pass, two worlds at a time over every node, and not twice at once for one server. It was inside the pass, in turn: a
   world is walked in seconds or, for a large one, in the minute its call is given, a server measured in a pass fell due in the next one at
   the same moment as every other, and a walk that failed was tried again at once, on every pass, for ever. A failure is now waited out for
   as long as a success is, and said once. */
const worldsMeasuring = new Set<string>();
const worldFailedAt = new Map<string, number>();
const worldGate = gate(2);
const background = new Set<Promise<void>>();

function startWorldMeasure(runtime: IGameRuntime, ref: RuntimeRef, server: Server, nodeName: string) {
  const now = Date.now();
  if (worldsMeasuring.has(server.id)) return;
  if (!worldSizeDue(server.worldSizeAt, server.id, now, WORLD_SIZE_EVERY_MS)) return;
  const failed = worldFailedAt.get(server.id);
  if (failed !== undefined && now - failed < WORLD_SIZE_EVERY_MS) return;

  worldsMeasuring.add(server.id);
  const job: Promise<void> = worldGate(() => measureWorld(runtime, ref, server))
    .then(
      () => {
        worldFailedAt.delete(server.id);
      },
      (error: unknown) => {
        worldFailedAt.set(server.id, Date.now());
        logger.warn("the size of a world was not measured", { server: server.name, node: nodeName, detail: asPlatformError(error).message, retryInMs: WORLD_SIZE_EVERY_MS });
      },
    )
    .finally(() => {
      worldsMeasuring.delete(server.id);
      background.delete(job);
    });
  background.add(job);
}

/** Waits for the measurements that were started, for a caller that wants them done before it looks (a single pass, a test). */
export async function settleBackground(): Promise<void> {
  while (background.size > 0) await Promise.allSettled([...background]);
}

async function measureWorld(runtime: IGameRuntime, ref: RuntimeRef, server: Server) {
  const { bytes } = await runtime.usage(ref);
  const quotaBytes = server.diskQuota * 1024 ** 3;
  await db.server.update({
    where: { id: server.id },
    data: {
      worldSizeBytes: BigInt(bytes),
      worldSizeAt: new Date(),
      diskPct: quotaBytes > 0 ? Math.min(100, Math.round((bytes / quotaBytes) * 100)) : 0,
    },
  });
}

/* A workload removed outside the panel. See domain/servers/state.ts.

   The row is read again first: an update in this same pass may have
   swapped the workload, and a stale id missing is not news. The runtime
   id is cleared — there is nothing left for it to name, and a stale one
   would send every later action to a container that does not exist —
   and the server's files are left exactly where they are. */
async function recordMissingWorkload(server: Server, nodeName: string): Promise<boolean> {
  const current = await db.server.findUnique({ where: { id: server.id } });
  if (!current || current.runtimeId !== server.runtimeId) return false;

  const decision = workloadMissing(current.state);
  if (decision.held) return false;

  await db.server.update({
    where: { id: server.id },
    data: {
      state: decision.state,
      runtimeId: null,
      startedAt: null,
      readyAt: null,
      cpuPct: 0,
      ramPct: 0,
      playersOn: 0,
      lastError: `Its workload was removed from ${nodeName} outside the panel.`,
    },
  });
  if (decision.event) {
    await db.activityEvent.create({
      data: {
        actor: "Watchdog",
        action: decision.event.action,
        target: server.name,
        tone: decision.event.tone,
        serverId: server.id,
        changes: { State: { from: current.state, to: decision.state } },
      },
    });
  }
  return true;
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
    report.errors.push(`${server.name}: could not be restarted (${bare(asPlatformError(error, `restarting ${server.name}`).message)})`);
    await db.server.update({
      where: { id: server.id },
      data: { restartAttempts: decision.attempt, lastRestartAt: new Date() },
    });
    await recoveryFailed(server, decision.attempt, asPlatformError(error).message);
  }
}

/* A restart that did not work is a line in the audit log, as one that did is: the log used to hold "recovered" and, once the attempts ran
   out, "abandoned", and nothing for the attempts in between, so a server that would not start looked untouched until it was given up on. */
async function recoveryFailed(server: Server, attempt: number, reason: string) {
  await db.activityEvent
    .create({
      data: {
        actor: "Watchdog",
        action: "server.recovery.failed",
        target: server.name,
        tone: "WARNING",
        serverId: server.id,
        changes: { Attempt: { from: "—", to: `${attempt} of ${server.maxRestarts}` }, Reason: { from: "—", to: reason } },
      },
    })
    .catch(() => {});
}

/* A server that stopped without being asked, and whose policy is to start it again: started. With evidence that the
   machine did it, at once and for free; with none, under the same ceiling and delays as a crash. See
   domain/servers/recovery.ts for what "without being asked" means and why a reboot was not a crash. This also runs, on
   later passes, for a server that is only waiting out its backoff. A server whose policy does not start it again is not
   touched here: it is reported once the pass knows how many stopped together (reportLeftStopped). */
async function recoverAfterStop(runtime: IGameRuntime, server: Server, evidence: StopEvidence, report: PollReport) {
  const decision = decideAfterStop({
    policy: server.restartPolicy,
    attempts: server.restartAttempts,
    maxRestarts: server.maxRestarts,
    lastRestartAt: server.lastRestartAt,
    evidence,
  });

  if (decision.action === "ignore") return;

  if (decision.action === "wait") {
    if (!(server.lastError ?? "").startsWith(STOP_PENDING)) {
      await db.server.update({ where: { id: server.id }, data: { lastError: `${STOP_PENDING}; starting it again when its turn comes.` } });
    }
    return;
  }

  if (decision.action === "give-up") {
    report.gaveUp++;
    await db.server.update({ where: { id: server.id }, data: { state: "ERROR", lastError: decision.reason } });
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
      data: { state: "STARTING", restartAttempts: decision.attempt, lastRestartAt: new Date(), startedAt: new Date(), lastError: null },
    });
    await db.activityEvent.create({
      data: {
        actor: "Watchdog",
        action: "server.recovered",
        target: server.name,
        tone: "INFO",
        serverId: server.id,
        changes: {
          Attempt: { from: "—", to: `${decision.attempt} of ${server.maxRestarts}` },
          Reason: { from: "—", to: decision.reason },
        },
      },
    });
  } catch (error) {
    // The attempt counts, as it does for a crash, and the marker stays so the next pass tries again.
    report.errors.push(`${server.name}: could not be started again (${bare(asPlatformError(error, `starting ${server.name} again`).message)})`);
    await db.server.update({
      where: { id: server.id },
      data: { restartAttempts: decision.attempt, lastRestartAt: new Date(), lastError: `${STOP_PENDING}; the last attempt to start it failed: ${asPlatformError(error).message}` },
    });
    await recoveryFailed(server, decision.attempt, asPlatformError(error).message);
  }
}

/** A server found stopped, in one pass, that the panel had not asked to stop. */
interface Unrequested {
  server: Server;
  exitCode: number | null;
  /** What its game said when it stopped, when its definition knows that failure. */
  known: string | null;
}

/* The servers of one node that stopped without being asked, and whose restart policy leaves them down: the page of
   each says why in one sentence, and the audit log gets one row, which is what becomes a message.

   Said after the whole node has been read, because what can be claimed about why depends on how many stopped
   together: a machine or Docker restarting ends everything on the node in the same pass, one game quitting does
   not. A server whose policy starts it again is not here; the rows of its restart say what happened. */
async function reportLeftStopped(nodeName: string, stops: Unrequested[]) {
  for (const stop of stops) {
    if (stop.server.restartPolicy === "ALWAYS") continue;
    const reason = leftStoppedReason({
      policy: stop.server.restartPolicy,
      evidence: stopEvidence(stop.exitCode, stops.length),
      node: nodeName,
      others: stops.length - 1,
      known: stop.known,
    });
    await db.server.update({ where: { id: stop.server.id }, data: { lastError: reason } });
    await db.activityEvent.create({
      data: {
        actor: "Watchdog",
        action: "server.left.stopped",
        target: stop.server.name,
        tone: "WARNING",
        serverId: stop.server.id,
        changes: { Reason: { from: "—", to: reason } },
      },
    });
  }
}

/* The last answer each server gave to each query, for a probe that is
   asked less often than the pass runs. In this process and nowhere else:
   the poller is one process by design, and losing this on a restart
   costs one question asked early. */
const lastQueries = new Map<string, { at: number; run: string; verdict: QueryVerdict }>();

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
): Promise<(HealthReport & { readyAt: Date | null }) | null> {
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

  const settings = currentConfig(game, server);
  const queries: NonNullable<HealthEvidence["queries"]> = {};
  for (const probe of game.health.probes) {
    if (probe.kind !== "query") continue;
    const plan = queryPlan(probe.protocol);
    if (!plan || !queryApplies(probe, settings)) continue;

    /* A game that writes every question to its console is asked less
       often than the pass runs, and the last answer stands in between.
       Kept per run: a restart is asked again at once. */
    const key = `${server.id}:${probe.protocol}`;
    const last = lastQueries.get(key);
    const run = startedAt ?? "";
    if (last && last.run === run && Date.now() - last.at < (probe.everySeconds ?? 0) * 1000) {
      queries[probe.protocol] = last.verdict;
      continue;
    }

    const port = portsFor(game, server.port).find((p) => p.id === (probe.port ?? plan.defaultPort));
    if (!port) {
      queries[probe.protocol] = null;
      continue;
    }
    const verdict = await runtime
      .exchange(ref, {
        port: port.host,
        transport: plan.transport,
        payload: plan.payload,
        maxBytes: plan.maxBytes,
        timeoutMs: plan.timeoutMs,
      })
      .then((answer) => judgeQueryReply(probe.protocol, answer.reply, answer.ended as ExchangeEnd))
      // The node not answering is not the game not answering.
      .catch(() => null);
    queries[probe.protocol] = verdict;
    /* Only a good answer stands in for the next ones. A game that has
       stopped answering is asked again on every pass: a few extra lines
       in its console cost nothing beside hearing that it is back. */
    if (verdict?.ok) lastQueries.set(key, { at: Date.now(), run, verdict });
    else lastQueries.delete(key);
  }

  const needsLogs =
    game.health.probes.some((p) => p.kind === "log") || game.health.crashPattern || (game.health.failures?.length ?? 0) > 0;
  const logLines = needsLogs
    ? await runtime
        .logs(ref, 120)
        .then((lines) => lines.map((l) => l.line))
        .catch(() => [])
    : [];

  const evidence = {
    running: true,
    startedAt: startedAt ? new Date(startedAt) : server.startedAt,
    ports,
    queries,
    settings,
    logLines,
    readyAt: server.readyAt,
  };

  /* The moment the console first says it is ready in this run, kept so
     the check still knows after the line scrolls out of the window.
     Never earlier than the run's own start: the node's clock and this
     one are not the same clock, and a readiness stamped a second before
     the container started would not count for it. */
  const now = new Date();
  const readyAt = becameReady(game, evidence)
    ? evidence.startedAt && evidence.startedAt > now
      ? evidence.startedAt
      : now
    : null;

  return { ...assessServerHealth(game, evidence), readyAt };
}

/** Samples older than the window are of no use to any chart the panel draws. */
/* A session that has expired is dead the moment it does: signing in again makes a
   new one, and nothing reads the old row but a count. They were never removed —
   the only deletions were a person signing out, changing a password or ending
   their sessions — so the table grew by a row per sign-in for ever, and the
   Members page, which counted the rows, counted the dead ones too. Nothing is
   kept back for a margin: there is nothing a row that has expired is still for. */
export async function pruneSessions(now = new Date()): Promise<number> {
  const { count } = await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  return count;
}

export async function pruneSamples(days = 30): Promise<number> {
  const before = new Date(Date.now() - days * 24 * 3600_000);
  const { count } = await db.metricSample.deleteMany({ where: { at: { lt: before } } });
  // A node's history is kept as long as a server's. The count is the servers', which is what the callers ask.
  await db.nodeSample.deleteMany({ where: { at: { lt: before } } });
  return count;
}
