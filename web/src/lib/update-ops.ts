import "server-only";
import type { Prisma, Server, User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import { PlatformError, asPlatformError } from "@/domain/errors";
import { currentConfig, renderConfig, scopeToLine } from "@/domain/games/config";
import { installServer } from "@/domain/games/install";
import { findGame, findVersion, versionOfServer } from "@/domain/games/registry";
import type { GameDefinition, GameVersion } from "@/domain/games/types";
import { readWorkloadSpec, workloadDifferences, workloadPlan, workloadSpec } from "@/domain/games/workload";
import { compareVersions, lineOf, updateTargetFor } from "@/domain/games/versions";
import { runtimeFor } from "@/domain/runtime/docker";
import type { IGameRuntime, RuntimeRef } from "@/domain/runtime/types";
import { stopGracefully } from "@/domain/servers/shutdown";
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

type Linked = Server & { gameVersionRef?: { slug: string } | null };

async function reach(user: User, slug: string, options: { workloadOptional?: boolean } = {}) {
  const server = await db.server.findUnique({
    where: { slug },
    include: {
      node: { select: { name: true, daemonUrl: true, daemonToken: true } },
      gameVersionRef: { select: { slug: true } },
    },
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
  if (!runtime) {
    throw new PlatformError(
      "RUNTIME_NOT_ATTACHED",
      `${server.node.name} has no agent attached, so there is nothing to update.`,
    );
  }
  if (!server.runtimeId && !options.workloadOptional) {
    throw new PlatformError(
      "RUNTIME_NOT_ATTACHED",
      `${server.name} has no workload on ${server.node.name}. Rebuild it first.`,
    );
  }

  return { server, game, runtime, ref: { serverId: server.id, runtimeId: server.runtimeId } };
}

/* The version a server is currently on, from its catalog link. Needed
   for the rollback record: without it, going back would mean guessing,
   and guessing at which build to reinstall is how a rollback makes
   things worse than the update did. */
function currentVersion(game: GameDefinition, server: Linked): GameVersion | undefined {
  return versionOfServer(game, {
    versionSlug: server.gameVersionRef?.slug,
    versionLabel: server.version,
  });
}

/* Was this server actually running before we touched it?

   Asked of the runtime rather than read off the row. The row is the
   panel's last look and can lag — a server that is RUNNING on its node
   while the row still says STARTING is the ordinary state of affairs
   between two poll passes. Rebuilding it as stopped on that evidence
   would leave a server down that nobody asked to stop, which is the one
   outcome an update must not produce quietly.

   The row is the fallback, because a node that will not answer this is
   about to fail the rest of the update anyway. */
export async function wasRunning(
  runtime: IGameRuntime,
  ref: RuntimeRef,
  server: Server,
): Promise<boolean> {
  try {
    const status = await runtime.status(ref);
    return status.state === "running" || status.state === "starting";
  } catch {
    return server.state === "RUNNING" || server.state === "UNHEALTHY";
  }
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

  const target = findVersion(game, targetVersionId);
  if (!target) {
    return { ok: false, title: "Unknown version", body: `${game.name} has no such version.` };
  }
  if (target.supported === false) {
    return { ok: false, title: "Not installable", body: `Geeboard does not install ${target.label}.` };
  }

  const from = currentVersion(game, server);
  if (from ? from.id === target.id : target.label === server.version) {
    return { ok: false, title: "Already there", body: `${server.name} is on ${target.label}.` };
  }

  /* ── What is not an update ──────────────────────────────────────
     Checked before the backup, because both are refusals and neither
     should cost the operator a stopped server to find out. The panel
     never offers these; the API takes any version id it is given. */
  if (from && lineOf(target) !== lineOf(from)) {
    return {
      ok: false,
      title: "Not an update",
      body: `${target.label} is a different line from ${from.label}, and what this server has built does not carry across. Create a new server on ${target.label} instead.`,
    };
  }
  if (from?.upstream && target.upstream && compareVersions(target.upstream, from.upstream) < 0) {
    return {
      ok: false,
      title: "Not an update",
      body: `${target.label} is older than ${from.label}, and a world does not open in an older version than made it. Rolling back is the way to undo an update.`,
    };
  }

  const running = await wasRunning(runtime, ref, server);

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
    await rebuildWorkload(server, game, target, runtime, ref, running, { proveItStarts: true });
  } catch (error) {
    const failure = asPlatformError(error);

    /* A failed install is unambiguous, so it is undone here rather than
       left for somebody to find. The world is already safe — the
       workload was destroyed with `withData: false` — so going back
       means reinstalling what was there, not restoring the archive. */
    const recovered = from
      ? await rebuildWorkload(server, game, from, runtime, ref, running, { proveItStarts: true })
          .then(() => true)
          .catch(() => false)
      : false;

    await db.server.update({
      where: { id: server.id },
      data: recovered
        ? { state: running ? "STARTING" : "STOPPED", lastError: null }
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
   what makes swapping the thing that runs them safe at all.

   `start` is whether the server should be running afterwards.
   `proveItStarts` starts the new workload even when it should not be:
   an update or a rollback installs a build the server has not run, and a
   build that will not start is caught — and undone — here, rather than
   at somebody's next start with no automatic way back. A rebuild on the
   same version has nothing to prove, so a stopped server is never
   started; starting and stopping it cost Terraria thirty seconds and a
   kill during boot.

   The settings are the ones on the `server` it is handed, not read back
   from the database — which is what lets a settings change use this same
   path: hand it the new settings, and if the workload will not start,
   hand it the old ones. A settings rebuild used to have a copy of this
   with no way back, and left the server in ERROR. */
export async function rebuildWorkload(
  server: Server,
  game: GameDefinition,
  version: GameVersion,
  runtime: IGameRuntime,
  ref: RuntimeRef,
  start: boolean,
  options: { proveItStarts?: boolean } = {},
): Promise<void> {
  const startOnce = start || options.proveItStarts === true;
  /* The settings of the line being installed. A rebuild stays on its
     line, so this is the server's own shape of the game; the world's
     rules are not rendered here at all (see RenderOptions.creating). */
  const scoped = scopeToLine(game, version.line);
  const rendered = renderConfig(scoped, currentConfig(scoped, server), version, { includeEmpty: true });
  await runtime.destroy(ref, false);
  /* Recorded at once. Until the install below finishes there is no
     workload, and a failure has to leave a row that says so: a stale id
     is found missing by the next poll and reported as a container
     removed outside the panel, over the reason the update gave. */
  await db.server.update({ where: { id: server.id }, data: { runtimeId: null } });

  const plan = workloadPlan(
    game,
    version,
    { id: server.id, slug: server.slug, port: server.port, memoryGb: server.memoryLimit, cpuLimit: server.cpuLimit },
    rendered,
  );
  const result = await installServer({
    game,
    runtime,
    files: rendered.files,
    // A failure here must not take the world — or the backup beside it.
    existingData: true,
    start: startOnce,
    plan,
    report: () => {},
  });

  // Proven, and put back the way it was: a server stopped before is stopped after.
  const state = start ? mapRuntimeState(result.state) : "STOPPED";
  if (startOnce && !start) {
    await runtime.stop({ ...ref, runtimeId: result.ref.runtimeId }, 30).catch(() => {});
  }

  await db.server.update({
    where: { id: server.id },
    data: {
      runtimeId: result.ref.runtimeId,
      state,
      startedAt: state === "RUNNING" ? new Date(result.startedAt ?? Date.now()) : null,
      // What this workload was made from — see domain/games/workload.ts.
      builtSpec: workloadSpec(plan, game) as unknown as Prisma.InputJsonValue,
    },
  });
}

/* ── Rebuilding on the same version ────────────────────────────────
   A new workload around the same files, from the version the server is
   already on.

   Two jobs. The workload is gone — removed outside the panel, or left
   behind by a failed update — and there is nothing to start. Or the
   version's definition changed what a workload is given (Zomboid build
   41 moving to the legacy41 branch), which only a new workload picks up.

   No backup is taken, and that is deliberate rather than an oversight:
   the world is not touched. The workload is destroyed with
   `withData: false`, and a failure removes only what it made. */

export async function rebuildServerOp(user: User, slug: string): Promise<OpResult> {
  let context;
  try {
    context = await reach(user, slug, { workloadOptional: true });
  } catch (error) {
    return { ok: false, title: "Cannot rebuild", body: asPlatformError(error).message };
  }

  const { server, game, runtime, ref } = context;

  /* The catalog link, never a guess. Rebuilding a build 41 world on the
     definition's first version would open it in build 42. */
  const version = currentVersion(game, server);
  if (!version) {
    return {
      ok: false,
      title: "Cannot rebuild",
      body: `Geeboard cannot tell which ${game.name} version ${server.name} is on, so it will not guess which one to rebuild it from.`,
    };
  }
  if (version.supported === false) {
    return {
      ok: false,
      title: "Not installable",
      body: `Geeboard no longer installs ${version.label}. Update ${server.name} to a supported version instead.`,
    };
  }

  /* Started again if it was up. A workload that is gone was presumably
     meant to be running — nobody rebuilds a server to leave it off — and
     one that exists says for itself. A server stopped on purpose stays
     stopped. */
  const start = server.runtimeId
    ? await wasRunning(runtime, ref, server)
    : server.state !== "STOPPED" && server.state !== "STOPPING" && server.state !== "SUSPENDED";

  if (server.runtimeId && start) {
    await stopGracefully(runtime, ref, game.console, { graceSeconds: 30 });
  }

  await db.server.update({ where: { id: server.id }, data: { state: "UPDATING" } });

  try {
    await rebuildWorkload(server, game, version, runtime, ref, start);
  } catch (error) {
    const failure = asPlatformError(error);
    await db.server.update({
      where: { id: server.id },
      data: { state: "ERROR", lastError: `Rebuild failed: ${failure.message}` },
    });
    await db.activityEvent.create({
      data: {
        actor: user.name,
        action: "server.rebuild.failed",
        target: server.name,
        tone: "DANGER",
        userId: user.id,
        serverId: server.id,
        changes: { Reason: { from: "—", to: failure.message } },
      },
    });
    return {
      ok: false,
      title: "Rebuild failed",
      body: `${failure.message}. The server's files are untouched.`,
    };
  }

  await db.server.update({
    where: { id: server.id },
    // A fresh workload: whatever went wrong with the last one is not this one's history.
    data: { lastError: null, restartAttempts: 0, readyAt: null },
  });
  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "server.rebuilt",
      target: server.name,
      tone: "SUCCESS",
      userId: user.id,
      serverId: server.id,
      changes: { Workload: { from: server.runtimeId ? "replaced" : "missing", to: version.label } },
    },
  });

  return {
    ok: true,
    tone: "success",
    title: `${server.name} rebuilt`,
    body: `A new workload on ${version.label}, around the same files${start ? ", started" : ", left stopped as it was"}.`,
  };
}

/* ── Going back ───────────────────────────────────────────────────── */

export async function rollbackServerOp(user: User, slug: string): Promise<OpResult> {
  let context;
  try {
    /* A server with no workload can go back too. It used to be told to
       rebuild first — on the version it was trying to get away from, and
       the usual reason a server has a rollback point and no workload is
       that the update left it that way. Going back needs the archive, the
       directory and a node; the workload it makes itself. */
    context = await reach(user, slug, { workloadOptional: true });
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

  // By id, which a later rename cannot break — findVersion knows former ids.
  const target = server.rollbackVersionId
    ? findVersion(game, server.rollbackVersionId)
    : game.versions.find((v) => v.label === server.rollbackVersionLabel);

  if (!target) {
    return {
      ok: false,
      title: "That version is gone",
      body: `${server.rollbackVersionLabel} is no longer in the catalog, so Geeboard cannot reinstall it.`,
    };
  }

  // As a rebuild decides it: a workload that is gone was meant to be running.
  const running = server.runtimeId
    ? await wasRunning(runtime, ref, server)
    : server.state !== "STOPPED" && server.state !== "STOPPING" && server.state !== "SUSPENDED";
  await db.server.update({ where: { id: server.id }, data: { state: "UPDATING" } });

  try {
    /* Stop, then the world, then the build.

       The order matters in one direction only: the server must not be
       running while its directory is replaced, or the process writes
       into a world that is being unpacked underneath it. Restoring
       before the rebuild rather than after means the old world is never
       briefly open under the new version. */
    if (running && server.runtimeId) await stopGracefully(runtime, ref, game.console, { graceSeconds: 30 });
    await runtime.backups.restore(ref, backup.artifact, backup.checksum ?? undefined);
    await rebuildWorkload(server, game, target, runtime, ref, running, { proveItStarts: true });
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

/* Whether this server's workload is still what it would be made from
   today — see domain/games/workload.ts.

   Null is "cannot say": no workload, a workload made before this was
   recorded, a game or a version that no longer resolves. An empty list is
   "yes, it is". Anything else is what a rebuild would change, and the
   version panel says it beside the button that does it. Nothing here
   asks the node; it is the row against the definition. */
export function rebuildNeededFor(server: Linked): string[] | null {
  const built = readWorkloadSpec(server.builtSpec);
  if (!built || !server.runtimeId) return null;

  const game = server.gameId ? findGame(server.gameId) : undefined;
  const version = game ? currentVersion(game, server) : undefined;
  if (!game || !version || version.supported === false) return null;

  const scoped = scopeToLine(game, version.line);
  const rendered = renderConfig(scoped, currentConfig(scoped, server), version, { includeEmpty: true });
  const now = workloadSpec(
    workloadPlan(
      game,
      version,
      { id: server.id, slug: server.slug, port: server.port, memoryGb: server.memoryLimit, cpuLimit: server.cpuLimit },
      rendered,
    ),
    game,
  );
  return workloadDifferences(built, now);
}

/* Asks the same question as the version panel's outlook, through the
   same function — so the badge saying "update available" and the button
   offering one cannot disagree about whether there is one. */
export async function updateOfferFor(server: Linked): Promise<UpdateOffer> {
  const game = server.gameId ? findGame(server.gameId) : undefined;
  const catalog = game ? await storedCatalog(game.id) : null;

  // Callers that loaded the link pass it; anyone else costs one lookup.
  const link =
    server.gameVersionRef !== undefined
      ? server.gameVersionRef
      : server.gameVersionId
        ? await db.gameVersion.findUnique({
            where: { id: server.gameVersionId },
            select: { slug: true },
          })
        : null;
  const slug = link?.slug ?? null;

  const available = catalog ? updateTargetFor(catalog, slug) : null;

  return {
    targetVersionId: available?.id ?? null,
    targetLabel: available?.label ?? null,
    rollback:
      server.rollbackVersionLabel && server.rollbackAt
        ? { label: server.rollbackVersionLabel, takenAt: server.rollbackAt }
        : null,
  };
}
