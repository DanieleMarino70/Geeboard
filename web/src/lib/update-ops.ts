import "server-only";
import type { Server, User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import { PlatformError, asPlatformError } from "@/domain/errors";
import { currentConfig, renderConfig } from "@/domain/games/config";
import { installServer } from "@/domain/games/install";
import { findGame } from "@/domain/games/registry";
import { portsFor, type GameDefinition, type GameVersion } from "@/domain/games/types";
import { runtimeFor } from "@/domain/runtime/docker";
import type { IGameRuntime, RuntimeRef } from "@/domain/runtime/types";
import { mapRuntimeState } from "@/domain/servers/state";
import { createBackupOp } from "./backup-ops";
import { storedCatalog } from "./catalog-read";
import { db } from "./db";
import type { OpResult } from "./server-ops";

/* Updating a server to a different version.

   The sequence, and the order is the whole design:

     back up        so there is a way back before anything moves
     stop           a world half-written by an update is not a world
     rebuild        destroy the workload, keep the data, install anew
     start
     record         what it was on, so going back is a button

   Never blindly overwrite a working server. The backup is not optional
   and it is locked, so a retention policy sweeping old archives is not
   the thing that quietly decides whether a rollback is still possible.

   What this deliberately does *not* do is roll back on a failed health
   check. A failed install or a workload that will not start is
   unambiguous and immediate, and is undone here without asking. A server
   that starts and then reports unhealthy might be unhealthy for reasons
   that have nothing to do with the update — and silently reverting
   somebody's world to a pre-update backup on that evidence would be a
   destructive surprise. That stays a button. */

type ServerWithNode = Server & {
  node: { name: string; daemonUrl: string | null; daemonToken: string | null };
};

async function reach(user: User, slug: string) {
  const server = await db.server.findUnique({
    where: { slug },
    include: { node: { select: { name: true, daemonUrl: true, daemonToken: true } } },
  });
  if (!server) throw new PlatformError("NOT_FOUND", "That server no longer exists.");

  if (!can(user, "server.update", server.ownerId)) {
    throw new PlatformError("FORBIDDEN", "You cannot update this server.");
  }

  const game = server.gameId ? findGame(server.gameId) : undefined;
  if (!game) {
    throw new PlatformError(
      "GAME_NOT_FOUND",
      "This server predates the game catalog, so Geeboard does not know what to update it to.",
    );
  }

  const runtime = runtimeFor(server.node);
  if (!runtime || !server.runtimeId) {
    throw new PlatformError(
      "RUNTIME_NOT_ATTACHED",
      `${server.node.name} has no agent attached, so there is nothing to update.`,
    );
  }

  return { server, game, runtime, ref: { serverId: server.id, runtimeId: server.runtimeId } };
}

/* The version a server is currently on, from its catalog link. Needed
   for the rollback record: without it, going back would mean guessing,
   and guessing at which build to reinstall is how a rollback makes
   things worse than the update did. */
function currentVersion(game: GameDefinition, server: Server): GameVersion | undefined {
  return game.versions.find((v) => v.label === server.version);
}

export async function updateServerOp(
  user: User,
  slug: string,
  targetVersionId: string,
): Promise<OpResult> {
  let context;
  try {
    context = await reach(user, slug);
  } catch (error) {
    const failure = asPlatformError(error);
    return { ok: false, title: "Cannot update", body: failure.message };
  }

  const { server, game, runtime, ref } = context;

  const target = game.versions.find((v) => v.id === targetVersionId);
  if (!target) {
    return { ok: false, title: "Unknown version", body: `${game.name} has no such version.` };
  }
  if (target.supported === false) {
    return { ok: false, title: "Not installable", body: `Geeboard does not install ${target.label}.` };
  }
  if (target.label === server.version) {
    return { ok: false, title: "Already there", body: `${server.name} is on ${target.label}.` };
  }

  const from = currentVersion(game, server);
  const wasRunning = server.state === "RUNNING" || server.state === "UNHEALTHY";

  /* ── The backup ─────────────────────────────────────────────────
     Before anything moves, and locked so retention cannot take it
     while it is still the way back. */
  const backup = await createBackupOp(user, slug, { trigger: "PRE_UPDATE" });
  if (!backup.ok || !backup.backupId) {
    return {
      ok: false,
      title: "Update stopped",
      body: `The backup failed, so nothing was changed. ${backup.body}`,
    };
  }
  await db.backup.update({ where: { id: backup.backupId }, data: { state: "LOCKED" } });

  await db.server.update({ where: { id: server.id }, data: { state: "UPDATING" } });

  try {
    await rebuild(server, game, target, runtime, ref, wasRunning);
  } catch (error) {
    const failure = asPlatformError(error);

    /* A failed install is unambiguous, so it is undone here rather than
       left for somebody to find. The world is already safe — the
       workload was destroyed with `withData: false` — so going back
       means reinstalling what was there, not restoring the archive. */
    const recovered = from
      ? await rebuild(server, game, from, runtime, ref, wasRunning)
          .then(() => true)
          .catch(() => false)
      : false;

    await db.server.update({
      where: { id: server.id },
      data: recovered
        ? { state: wasRunning ? "STARTING" : "STOPPED", lastError: null }
        : { state: "ERROR", lastError: `Update failed: ${failure.message}` },
    });

    await db.activityEvent.create({
      data: {
        actor: user.name,
        action: "server.update.failed",
        target: server.name,
        tone: "DANGER",
        userId: user.id,
        serverId: server.id,
        changes: {
          Version: { from: server.version, to: target.label },
          Reason: { from: "—", to: failure.message },
        },
      },
    });

    return {
      ok: false,
      title: "Update failed",
      body: recovered
        ? `${failure.message}. ${server.name} was put back on ${server.version}.`
        : `${failure.message}. ${server.name} could not be put back and needs looking at; its world is intact and ${backup.title.toLowerCase()} is locked.`,
    };
  }

  /* ── Recording it ───────────────────────────────────────────────
     Where it came from and the backup taken on the way, so rolling
     back is a button rather than an archaeology exercise. */
  const catalogVersion = await db.gameVersion.findUnique({
    where: { gameId_slug: { gameId: game.id, slug: target.id } },
    select: { id: true, buildId: true },
  });

  await db.server.update({
    where: { id: server.id },
    data: {
      version: target.label,
      gameVersionId: catalogVersion?.id ?? server.gameVersionId,
      installedBuildId: catalogVersion?.buildId ?? null,
      rollbackVersionId: from?.id ?? null,
      rollbackVersionLabel: server.version,
      rollbackBackupId: backup.backupId,
      rollbackAt: new Date(),
      lastError: null,
      healthDetail: null,
      // A new build is a new chance; whatever the old one was doing to
      // its crash budget is not this one's fault.
      restartAttempts: 0,
    },
  });

  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "server.updated",
      target: server.name,
      tone: "SUCCESS",
      userId: user.id,
      serverId: server.id,
      changes: { Version: { from: server.version, to: target.label } },
    },
  });

  return {
    ok: true,
    tone: "success",
    title: `${server.name} updated`,
    body: `${server.version} → ${target.label}. A locked backup was taken first, so this can be undone.`,
  };
}

/* Rebuilds a workload around a different version.

   The world survives because the workload is destroyed with
   `withData: false` — the server's files live in the volume, which is
   what makes swapping the thing that runs them safe at all. */
async function rebuild(
  server: Server,
  game: GameDefinition,
  version: GameVersion,
  runtime: IGameRuntime,
  ref: RuntimeRef,
  start: boolean,
): Promise<void> {
  const rendered = renderConfig(game, currentConfig(game, server), version, { includeEmpty: true });
  const ports = portsFor(game, server.port);

  await runtime.destroy(ref, false);

  const result = await installServer({
    game,
    runtime,
    files: rendered.files,
    plan: {
      serverId: server.id,
      name: server.slug,
      source: version.image,
      ports: ports.map((p) => ({
        label: p.label,
        host: p.host,
        container: p.container,
        protocol: p.protocol,
      })),
      memoryMb: server.memoryLimit * 1024,
      cpuLimit: server.cpuLimit,
      env: { ...rendered.env, GEEBOARD_SERVER: server.slug },
      start: false,
    },
    report: () => {},
  });

  /* installServer starts it as its last step; a server that was stopped
     before the update should still be stopped after one. */
  const state = start ? mapRuntimeState(result.state) : "STOPPED";
  if (!start) await runtime.stop({ ...ref, runtimeId: result.ref.runtimeId }, 30).catch(() => {});

  await db.server.update({
    where: { id: server.id },
    data: {
      runtimeId: result.ref.runtimeId,
      state,
      startedAt: state === "RUNNING" ? new Date(result.startedAt ?? Date.now()) : null,
    },
  });
}

/* ── Going back ───────────────────────────────────────────────────── */

export async function rollbackServerOp(user: User, slug: string): Promise<OpResult> {
  let context;
  try {
    context = await reach(user, slug);
  } catch (error) {
    return { ok: false, title: "Cannot roll back", body: asPlatformError(error).message };
  }

  const { server, game, runtime, ref } = context;

  if (!server.rollbackVersionLabel || !server.rollbackBackupId) {
    return {
      ok: false,
      title: "Nothing to roll back to",
      body: `${server.name} has not been updated through Geeboard, so there is no recorded way back.`,
    };
  }

  const backup = await db.backup.findUnique({ where: { id: server.rollbackBackupId } });
  if (!backup?.artifact) {
    return {
      ok: false,
      title: "The backup is gone",
      body: "The archive taken before the update is no longer on the node, so rolling back would restore nothing.",
    };
  }

  const target = server.rollbackVersionId
    ? game.versions.find((v) => v.id === server.rollbackVersionId)
    : game.versions.find((v) => v.label === server.rollbackVersionLabel);

  if (!target) {
    return {
      ok: false,
      title: "That version is gone",
      body: `${server.rollbackVersionLabel} is no longer in the catalog, so Geeboard cannot reinstall it.`,
    };
  }

  const wasRunning = server.state === "RUNNING" || server.state === "UNHEALTHY";
  await db.server.update({ where: { id: server.id }, data: { state: "UPDATING" } });

  try {
    /* Stop, then the world, then the build.

       The order matters in one direction only: the server must not be
       running while its directory is replaced, or the process writes
       into a world that is being unpacked underneath it. Restoring
       before the rebuild rather than after means the old world is never
       briefly open under the new version. */
    if (wasRunning) await runtime.stop(ref, 30);
    await runtime.backups.restore(ref, backup.artifact, backup.checksum ?? undefined);
    await rebuild(server, game, target, runtime, ref, wasRunning);
  } catch (error) {
    const failure = asPlatformError(error);
    await db.server.update({
      where: { id: server.id },
      data: { state: "ERROR", lastError: `Rollback failed: ${failure.message}` },
    });
    return {
      ok: false,
      title: "Rollback failed",
      body: `${failure.message}. ${server.name} is stopped and needs looking at.`,
    };
  }

  const catalogVersion = await db.gameVersion.findUnique({
    where: { gameId_slug: { gameId: game.id, slug: target.id } },
    select: { id: true, buildId: true },
  });

  await db.server.update({
    where: { id: server.id },
    data: {
      version: target.label,
      gameVersionId: catalogVersion?.id ?? null,
      installedBuildId: catalogVersion?.buildId ?? null,
      // Going back twice is not a thing: there is one way back, and it
      // has just been taken.
      rollbackVersionId: null,
      rollbackVersionLabel: null,
      rollbackBackupId: null,
      rollbackAt: null,
      lastError: null,
      healthDetail: null,
      restartAttempts: 0,
    },
  });

  /* The backup has done its job. Unlocking returns it to the retention
     policy rather than leaving an archive pinned on the node forever. */
  await db.backup.update({ where: { id: backup.id }, data: { state: "COMPLETE" } });

  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "server.rolled_back",
      target: server.name,
      tone: "WARNING",
      userId: user.id,
      serverId: server.id,
      changes: { Version: { from: server.version, to: target.label } },
    },
  });

  return {
    ok: true,
    tone: "warning",
    title: `${server.name} rolled back`,
    body: `Back on ${target.label}, with the world as it was before the update.`,
  };
}

/* ── What the UI needs to offer the button ────────────────────────── */

export interface UpdateOffer {
  /** The version id an update would move to, or null when there is none. */
  targetVersionId: string | null;
  targetLabel: string | null;
  /** A rollback point, when the last update left one. */
  rollback: { label: string; takenAt: Date } | null;
}

export async function updateOfferFor(server: ServerWithNode | Server): Promise<UpdateOffer> {
  const game = server.gameId ? findGame(server.gameId) : undefined;
  const catalog = game ? await storedCatalog(game.id) : null;

  const recommended = catalog?.recommended ?? null;
  const available =
    recommended && recommended.label !== server.version && recommended.supported
      ? recommended
      : null;

  return {
    targetVersionId: available?.id ?? null,
    targetLabel: available?.label ?? null,
    rollback:
      server.rollbackVersionLabel && server.rollbackAt
        ? { label: server.rollbackVersionLabel, takenAt: server.rollbackAt }
        : null,
  };
}
