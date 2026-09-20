import "server-only";
import { Prisma } from "@prisma/client";
import type { Node, Server, User } from "@prisma/client";
import { asPlatformError, PlatformError } from "@/domain/errors";
import { currentConfig, renderConfig, scopeToLine } from "@/domain/games/config";
import { installServer } from "@/domain/games/install";
import { findGame, versionOfServer } from "@/domain/games/registry";
import type { GameDefinition } from "@/domain/games/types";
import { workloadPlan, workloadSpec } from "@/domain/games/workload";
import { cannotRun, checkCompatibility } from "@/domain/nodes/compatibility";
import { runtimeFor } from "@/domain/runtime/docker";
import type { IGameRuntime, RuntimeRef } from "@/domain/runtime/types";
import { stopGracefully } from "@/domain/servers/shutdown";
import { TRANSITIONAL, mapRuntimeState } from "@/domain/servers/state";
import { createBackupOp } from "./backup-ops";
import { capacityRefusal, freePortFor, profileOf } from "./create-ops";
import { db } from "./db";
import type { OpResult } from "./server-ops";
import { archiveKey, downloadUrl, offsiteTarget } from "./storage-ops";

/* Moving a server to another node.

   Through the bucket, deliberately. The two nodes never talk to each
   other — an agent has no way to reach another agent and should not
   grow one — so the world goes up to the off-site store from the node
   it is on and comes down onto the node it is going to, on URLs the
   panel signs. The move leaves an off-site backup behind as a side
   effect, which is the right side effect to have.

   The sequence, and where each step can be undone:

     stop        the game's own stop, so the world on disk is whole
     back up     off-site, locked for the duration
     port        a free block on the target — it may differ
     provision   a stopped workload on the target, around a new directory
     restore     the archive, pulled down and hashed, replaces that directory
     switch      the row: node, port, workload — one write, undone if the
                 target will not start
     start       on the target, if it was running before
     remove      the old workload and directory, last of all

   Until the switch, the server is untouched on its old node and a
   failure only cleans up the target. Between the switch and the start
   the old workload still exists, so a target that will not start puts
   the row back and starts the old one. Only once the server is running
   where it is going does the old copy go. */

function refuse(title: string, body: string): OpResult {
  return { ok: false, title, body };
}

/* ── Where it could go ──────────────────────────────────────────── */

export interface MoveCandidate {
  name: string;
  city: string;
  region: string;
  /** Null when it can take the server; the refusal otherwise, in words. */
  blocker: string | null;
}

/* Every other node, and whether it could take this server: the same
   checks a create makes — approval, rotation, an agent, capacity, and
   whether the game can run there — so the settings page can show the
   answer before anybody presses the button. */
export async function moveCandidates(server: Server, game: GameDefinition | undefined): Promise<MoveCandidate[]> {
  const nodes = await db.node.findMany({ where: { id: { not: server.nodeId } }, orderBy: { name: "asc" } });
  const size = { memoryGb: server.memoryLimit, cpuLimit: server.cpuLimit, diskGb: server.diskQuota };
  const out: MoveCandidate[] = [];
  for (const node of nodes) {
    out.push({ name: node.name, city: node.city, region: node.region, blocker: await blockerFor(node, size, game) });
  }
  return out;
}

async function blockerFor(
  node: Node,
  size: { memoryGb: number; cpuLimit: number; diskGb: number },
  game: GameDefinition | undefined,
): Promise<string | null> {
  if (!node.approvedAt) return "Not approved yet.";
  if (node.state === "DRAINING") return "Draining: it takes no new servers.";
  if (node.state === "MAINTENANCE") return "Under maintenance.";
  if (node.state === "UNREACHABLE") return "The panel cannot reach it.";
  if (!node.daemonUrl || !node.daemonToken) return "No agent attached.";
  const capacity = await capacityRefusal(node, size);
  if (capacity) return capacity.body;
  if (game) {
    const cannot = cannotRun(checkCompatibility(game, await profileOf(node), size));
    if (cannot.length > 0) return cannot.join(" ");
    if ((await freePortFor(game, node.id)) === null) return `No free ${game.name} port block.`;
  }
  return null;
}

/* ── The move ───────────────────────────────────────────────────── */

export async function moveServerOp(user: User, slug: string, targetName: string): Promise<OpResult> {
  /* Placing a server commits a node's resources; the same roles that
     create and delete servers move them. */
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    return refuse("Not permitted", "Only owners and admins can move a server between nodes.");
  }

  const server = await db.server.findUnique({
    where: { slug },
    include: {
      node: { select: { id: true, name: true, daemonUrl: true, daemonToken: true } },
      gameVersionRef: { select: { slug: true } },
    },
  });
  if (!server) return refuse("Cannot move", "That server no longer exists.");
  if (TRANSITIONAL.has(server.state)) {
    return refuse("Busy", `${server.name} is ${server.state.toLowerCase().replace("_", " ")}. Wait for that to finish.`);
  }

  const game = server.gameId ? findGame(server.gameId) : undefined;
  const version = game
    ? versionOfServer(game, { versionSlug: server.gameVersionRef?.slug, versionLabel: server.version })
    : undefined;
  if (!game || !version) {
    return refuse("Cannot move", `Geeboard cannot tell what ${server.name} runs, so it cannot provision it anywhere else.`);
  }
  if (version.supported === false) {
    return refuse("Cannot move", `Geeboard no longer installs ${version.label}, so ${server.name} cannot be provisioned on another node.`);
  }

  const target = await db.node.findUnique({ where: { name: targetName } });
  if (!target) return refuse("Cannot move", "That node no longer exists.");
  if (target.id === server.nodeId) return refuse("Already there", `${server.name} is on ${target.name}.`);
  const blocker = await blockerFor(target, { memoryGb: server.memoryLimit, cpuLimit: server.cpuLimit, diskGb: server.diskQuota }, game);
  if (blocker) return refuse(`${target.name} cannot take ${server.name}`, blocker);

  const source = runtimeFor(server.node);
  const destination = runtimeFor(target);
  if (!source) return refuse("No agent on this node", `${server.node.name} has no agent attached, so nothing can be archived from it.`);
  if (!destination) return refuse("No agent on that node", `${target.name} has no agent attached.`);

  const offsite = await offsiteTarget();
  if (!offsite) {
    return refuse("No off-site storage", "A move goes through the bucket. Configure one on the Backups page first.");
  }

  /* A locked local backup is the way back from an update, and it lives
     on the node being left. Moving would destroy it, so the person who
     locked it decides. */
  const lockedLocal = await db.backup.count({ where: { serverId: server.id, state: "LOCKED", store: { not: "S3" } } });
  if (lockedLocal > 0) {
    return refuse(
      "A locked backup is on this node",
      `${lockedLocal} locked backup${lockedLocal === 1 ? " lives" : "s live"} on ${server.node.name} and would be lost. Unlock ${lockedLocal === 1 ? "it" : "them"} first if the move matters more.`,
    );
  }

  const port = await freePortFor(game, target.id);
  if (port === null) return refuse(`${target.name} has no ports left`, `No free ${game.name} port block.`);

  const sourceRef: RuntimeRef = { serverId: server.id, runtimeId: server.runtimeId };
  // What the workload being left was made from, for a move that is undone.
  const previousSpec = (server.builtSpec as Prisma.InputJsonValue | null) ?? Prisma.DbNull;
  const targetRef: RuntimeRef = { serverId: server.id, runtimeId: null };
  const dialect = game.console;
  const stateBefore = server.state;
  const wasRunning = await upOn(source, sourceRef, server);

  await db.server.update({ where: { id: server.id }, data: { state: "MIGRATING" } });

  let backupId: string | null = null;
  let provisioned = false;
  let switched = false;

  try {
    // Stop: the world on disk has to be the whole world.
    if (wasRunning && server.runtimeId) {
      await stopGracefully(source, sourceRef, dialect, { graceSeconds: dialect.stopGraceSeconds ?? 30 });
    }

    // Back up, off-site, and lock it so retention cannot take it mid-move.
    const backup = await createBackupOp(user, slug, { store: "S3", skipQuiesce: true, prefix: "move" });
    if (!backup.ok || !backup.backupId) throw new PlatformError("SERVER_INSTALLATION_FAILED", backup.body, { details: { step: "backup" } });
    backupId = backup.backupId;
    await db.backup.update({ where: { id: backupId }, data: { state: "LOCKED" } });
    const archive = await db.backup.findUniqueOrThrow({ where: { id: backupId } });
    if (!archive.artifact) throw new PlatformError("SERVER_INSTALLATION_FAILED", "the move backup has no archive", { details: { step: "backup" } });

    /* Provision on the target, stopped, around a new directory. The
       settings are rendered as a rebuild renders them — the server's
       own, on its own line, and never the world's rules. */
    const scoped = scopeToLine(game, version.line);
    const rendered = renderConfig(scoped, currentConfig(scoped, server), version, { includeEmpty: true });
    // The same plan a rebuild would make, on the port it was given over there.
    const plan = workloadPlan(
      game,
      version,
      { id: server.id, slug: server.slug, port, memoryGb: server.memoryLimit, cpuLimit: server.cpuLimit },
      rendered,
    );
    const installed = await installServer({
      game,
      runtime: destination,
      files: rendered.files,
      start: false,
      plan,
      report: () => {},
    });
    provisioned = true;
    targetRef.runtimeId = installed.ref.runtimeId;

    // The world comes down from the bucket onto the target, hashed, and replaces the directory.
    const key = archiveKey(offsite.prefix, server.id, archive.artifact);
    await destination.backups.download(targetRef, archive.artifact, downloadUrl(offsite, key), archive.checksum ?? undefined);
    await destination.backups
      .restore(targetRef, archive.artifact, archive.checksum ?? undefined)
      .finally(() => destination.backups.remove(targetRef, archive.artifact!).catch(() => {}));

    /* The switch. One write; the unique (node, port) index turns a port
       taken since it was chosen into a failed write, not two servers on
       one address. */
    try {
      await db.server.update({
        where: { id: server.id },
        data: {
          nodeId: target.id,
          port,
          runtimeId: targetRef.runtimeId,
          healthDetail: null,
          lastError: null,
          restartAttempts: 0,
          // The workload over there was made from this, ports and all.
          builtSpec: workloadSpec(plan, game) as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new PlatformError("CONFLICT", `port ${port} on ${target.name} was taken by another server meanwhile`, { details: { step: "switch" } });
      }
      throw error;
    }
    switched = true;

    if (wasRunning) {
      try {
        await destination.start(targetRef);
      } catch (error) {
        // The old workload is still there: put the row back and start it.
        await db.server.update({
          where: { id: server.id },
          data: { nodeId: server.nodeId, port: server.port, runtimeId: server.runtimeId, builtSpec: previousSpec },
        });
        switched = false;
        throw asPlatformError(error);
      }
    }

    /* Only now does the old copy go: workload, directory, and the local
       backups beside it, whose rows go too. Off-site backups stay where
       they are and still point at this server. */
    const localBackups = await db.backup.deleteMany({ where: { serverId: server.id, store: { not: "S3" } } });
    let oldRemoved = true;
    await source.destroy(sourceRef, true).catch(() => {
      oldRemoved = false;
    });

    await db.backup.update({ where: { id: backupId }, data: { state: "COMPLETE" } });
    /* The state as the target reports it, not as hoped: a server that
       is already running is RUNNING now rather than STARTING until the
       next poll — and a script with no poller behind it can go on. */
    const observed = wasRunning
      ? await destination.status(targetRef).then((s) => mapRuntimeState(s.state), () => "STARTING" as const)
      : ("STOPPED" as const);
    await db.server.update({
      where: { id: server.id },
      data: { state: observed, startedAt: wasRunning ? new Date() : null },
    });

    await db.activityEvent.create({
      data: {
        actor: user.name,
        action: "server.moved",
        target: server.name,
        tone: "WARNING",
        userId: user.id,
        serverId: server.id,
        changes: {
          Node: { from: server.node.name, to: target.name },
          Address: { from: `${server.host}:${server.port}`, to: `${server.host}:${port}` },
          Backup: { from: "—", to: archive.name },
          ...(localBackups.count > 0 ? { "Local backups removed": { from: String(localBackups.count), to: "0" } } : {}),
          ...(oldRemoved ? {} : { "Old copy": { from: server.node.name, to: "still there — could not be removed" } }),
        },
      },
    });

    const portNote = port === server.port ? "" : ` Its port changed from ${server.port} to ${port}.`;
    const localNote = localBackups.count > 0 ? ` ${localBackups.count} local backup${localBackups.count === 1 ? "" : "s"} on ${server.node.name} ${localBackups.count === 1 ? "was" : "were"} removed with it; ${archive.name} is in the bucket.` : ` ${archive.name} is in the bucket.`;
    return {
      ok: true,
      tone: oldRemoved ? "success" : "warning",
      title: `${server.name} moved to ${target.name}`,
      body: oldRemoved
        ? `${wasRunning ? "It is starting there." : "It is stopped there, as it was."}${portNote}${localNote}`
        : `It is on ${target.name} now, but ${server.node.name} could not remove the old copy — delete it there by hand.${portNote}${localNote}`,
    };
  } catch (error) {
    const failure = asPlatformError(error);

    // Undo whatever was made on the target; the source was never touched past a stop.
    if (provisioned) await destination.destroy(targetRef, true).catch(() => {});
    if (switched) {
      await db.server.update({
        where: { id: server.id },
        data: { nodeId: server.nodeId, port: server.port, runtimeId: server.runtimeId, builtSpec: previousSpec },
      }).catch(() => {});
    }
    if (backupId) await db.backup.update({ where: { id: backupId }, data: { state: "COMPLETE" } }).catch(() => {});

    let restarted = false;
    if (wasRunning && server.runtimeId) restarted = await source.start(sourceRef).then(() => true, () => false);
    await db.server.update({
      where: { id: server.id },
      data: restarted ? { state: "STARTING", startedAt: new Date() } : { state: wasRunning ? "ERROR" : stateBefore, lastError: wasRunning ? `Move failed: ${failure.message}` : null },
    });

    await db.activityEvent.create({
      data: {
        actor: user.name,
        action: "server.move.failed",
        target: server.name,
        tone: "DANGER",
        userId: user.id,
        serverId: server.id,
        changes: { Reason: { from: "—", to: failure.message }, Node: { from: server.node.name, to: target.name } },
      },
    });

    const step = typeof failure.details?.step === "string" ? ` while ${failure.details.step}` : "";
    return refuse(
      `Move failed${step}`,
      `${failure.message}. ${server.name} is still on ${server.node.name}${wasRunning ? (restarted ? " and starting again" : " and could not be restarted") : ""}; nothing was left on ${target.name}.`,
    );
  }
}

async function upOn(runtime: IGameRuntime, ref: RuntimeRef, server: Server): Promise<boolean> {
  if (!server.runtimeId) return false;
  try {
    const status = await runtime.status(ref);
    return status.state === "running" || status.state === "starting";
  } catch {
    return server.state === "RUNNING" || server.state === "UNHEALTHY";
  }
}
