import "server-only";
import type { Server, User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import { asPlatformError, PlatformError } from "@/domain/errors";
import { findGame } from "@/domain/games/registry";
import { runtimeFor } from "@/domain/runtime/docker";
import type { IGameRuntime, RuntimeRef } from "@/domain/runtime/types";
import { db } from "./db";
import type { OpResult } from "./server-ops";

/* Backups that copy bytes.

   These used to write a row with a plausible size and a fabricated
   checksum, which is worse than having no backups at all: somebody
   stops worrying on the strength of it. Now the node archives the
   server's directory, hashes it on the way to disk, and the row records
   what actually happened.

   Two things this deliberately does not do. It does not hold an archive
   in the panel's memory — a Minecraft world is gigabytes and the panel
   never touches the bytes. And it does not pretend a node-local archive
   is safe from the node: `store` says LOCAL because that is what it is,
   and a machine that dies takes its own backups with it. */

type ServerWithNode = Server & {
  node: { name: string; daemonUrl: string | null; daemonToken: string | null };
};

async function reach(
  user: User,
  slug: string,
  need: "server.backup.read" | "server.backup.write",
): Promise<
  | { ok: true; server: ServerWithNode; runtime: IGameRuntime; ref: RuntimeRef }
  | { ok: false; result: OpResult }
> {
  const server = await db.server.findUnique({
    where: { slug },
    include: { node: { select: { name: true, daemonUrl: true, daemonToken: true } } },
  });
  if (!server) {
    return { ok: false, result: { ok: false, title: "Cannot back up", body: "That server no longer exists." } };
  }

  if (!can(user, need, server.ownerId)) {
    return {
      ok: false,
      result: { ok: false, title: "Not permitted", body: "You cannot manage this server's backups." },
    };
  }

  const runtime = runtimeFor(server.node);
  if (!runtime) {
    return {
      ok: false,
      result: {
        ok: false,
        title: "No agent on this node",
        body: `${server.node.name} has no agent attached, so there is nothing to archive.`,
      },
    };
  }

  return { ok: true, server, runtime, ref: { serverId: server.id, runtimeId: server.runtimeId } };
}

/* A name for the archive, and one that will not collide.

   Dated rather than sequential: a list of backups is read by a person
   deciding which one to go back to, and "manual-09-11" answers that
   question in a way "backup-7" never does. */
async function freeName(serverId: string, prefix: string): Promise<string> {
  const now = new Date();
  const stamp = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const base = `${prefix}-${stamp}`;

  const taken = await db.backup.count({ where: { serverId, name: { startsWith: base } } });
  return taken === 0 ? base : `${base}-${taken + 1}`;
}

export interface BackupOptions {
  trigger?: "MANUAL" | "SCHEDULED" | "PRE_UPDATE";
  /** Skip the console flush. Only for a server that is already stopped. */
  skipQuiesce?: boolean;
}

export async function createBackupOp(
  user: User,
  slug: string,
  options: BackupOptions = {},
): Promise<OpResult & { backupId?: string }> {
  const reached = await reach(user, slug, "server.backup.write");
  if (!reached.ok) return reached.result;
  const { server, runtime, ref } = reached;

  const trigger = options.trigger ?? "MANUAL";
  const name = await freeName(server.id, trigger === "MANUAL" ? "manual" : "auto");

  /* Flushing the world to disk first is the difference between a backup
     and a copy of a world halfway through a save. Every game definition
     that has a save command names it; one that does not gets a best
     effort and a slightly less certain archive. */
  const game = server.gameId ? findGame(server.gameId) : undefined;
  const saveCommand = game?.console.saveCommand;

  if (!options.skipQuiesce && saveCommand && server.state === "RUNNING" && server.runtimeId) {
    await runtime.sendCommand(ref, saveCommand).catch(() => {
      // A server that will not take a command is still worth archiving;
      // it just means the archive is a little less certain.
    });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  const record = await db.backup.create({
    data: { serverId: server.id, name, sizeBytes: BigInt(0), trigger, state: "RUNNING" },
  });

  /* BACKING_UP is platform-owned, so reconciliation will not overwrite
     it while the archive runs — and the operator can see why the server
     is briefly not answering the usual questions. */
  const stateBefore = server.state;
  await db.server.update({ where: { id: server.id }, data: { state: "BACKING_UP" } });

  try {
    const archive = await runtime.backups.create(ref, `${server.slug}-${name}`);

    await db.backup.update({
      where: { id: record.id },
      data: {
        state: "COMPLETE",
        sizeBytes: BigInt(archive.sizeBytes),
        checksum: archive.checksum,
        store: "LOCAL",
        artifact: archive.artifact,
        durationMs: archive.durationMs,
      },
    });
    await db.server.update({ where: { id: server.id }, data: { state: stateBefore } });

    await db.activityEvent.create({
      data: {
        actor: user.name,
        action: "backup.created",
        target: name,
        tone: "SUCCESS",
        userId: user.id,
        serverId: server.id,
        changes: {
          Size: { from: "—", to: `${(archive.sizeBytes / 1024 ** 3).toFixed(2)} GB` },
          Took: { from: "—", to: `${Math.round(archive.durationMs / 1000)}s` },
        },
      },
    });

    return {
      ok: true,
      tone: "success",
      title: "Backup complete",
      body: `${name} · ${(archive.sizeBytes / 1024 ** 3).toFixed(2)} GB in ${Math.round(archive.durationMs / 1000)}s, on ${server.node.name}.`,
      backupId: record.id,
    };
  } catch (error) {
    const failure = asPlatformError(error);
    /* A failed backup is recorded as failed rather than deleted. A row
       that vanishes leaves an operator believing the backup never
       started; one marked FAILED tells them it did and did not finish. */
    await db.backup.update({ where: { id: record.id }, data: { state: "FAILED" } });
    await db.server.update({ where: { id: server.id }, data: { state: stateBefore } });

    await db.activityEvent.create({
      data: {
        actor: user.name,
        action: "backup.failed",
        target: name,
        tone: "DANGER",
        userId: user.id,
        serverId: server.id,
        changes: { Reason: { from: "—", to: failure.message } },
      },
    });

    return { ok: false, title: "Backup failed", body: failure.message };
  }
}

/* Putting a world back.

   Destructive by design: the server's directory is replaced, not merged
   into. A restore that left files the backup does not contain — a
   corrupt region, a plugin added since — would not be a restore, it
   would be a state nobody has ever tested.

   The server is stopped first. Unpacking a world under a running
   process is how a save file becomes two halves of different saves. */
export async function restoreBackupOp(user: User, backupId: string): Promise<OpResult> {
  const backup = await db.backup.findUnique({ where: { id: backupId }, include: { server: true } });
  if (!backup) return { ok: false, title: "Cannot restore", body: "That backup no longer exists." };

  const reached = await reach(user, backup.server.slug, "server.backup.write");
  if (!reached.ok) return reached.result;
  const { server, runtime, ref } = reached;

  if (!backup.artifact) {
    return {
      ok: false,
      title: "Nothing to restore",
      body: `${backup.name} is a record from before Geeboard archived anything. There are no bytes behind it.`,
    };
  }
  if (backup.state === "FAILED" || backup.state === "RUNNING") {
    return {
      ok: false,
      title: "Not a finished backup",
      body: `${backup.name} did not complete, so restoring it would leave the world half-written.`,
    };
  }

  const wasRunning = server.state === "RUNNING" || server.state === "UNHEALTHY";

  await db.server.update({ where: { id: server.id }, data: { state: "UPDATING" } });

  try {
    if (wasRunning && server.runtimeId) {
      await runtime.stop(ref, 30);
    }

    /* The checksum recorded when the archive was written, checked again
       before a single byte is replaced. A backup nobody verified is a
       hope, and this is the moment it stops being one. */
    const result = await runtime.backups.restore(ref, backup.artifact, backup.checksum ?? undefined);

    if (wasRunning && server.runtimeId) {
      await runtime.start(ref);
    }

    await db.server.update({
      where: { id: server.id },
      data: {
        state: wasRunning ? "STARTING" : "STOPPED",
        lastError: null,
        // The world came from somewhere else; nothing known about it
        // survives, including how healthy it was a moment ago.
        healthDetail: null,
        restartAttempts: 0,
      },
    });

    await db.activityEvent.create({
      data: {
        actor: user.name,
        action: "backup.restored",
        target: backup.name,
        tone: "WARNING",
        userId: user.id,
        serverId: server.id,
        changes: { Files: { from: "—", to: String(result.files) } },
      },
    });

    return {
      ok: true,
      tone: "warning",
      title: `Restored ${backup.name}`,
      body: `${result.files} files written to ${server.name}${wasRunning ? ", and it is starting again" : ""}.`,
    };
  } catch (error) {
    const failure = asPlatformError(error);
    await db.server.update({
      where: { id: server.id },
      data: { state: "ERROR", lastError: `Restore failed: ${failure.message}` },
    });
    return {
      ok: false,
      title: "Restore failed",
      body: `${failure.message}. ${server.name} is stopped and needs looking at.`,
    };
  }
}

export async function deleteBackupOp(user: User, backupId: string): Promise<OpResult> {
  const backup = await db.backup.findUnique({ where: { id: backupId }, include: { server: true } });
  if (!backup) return { ok: false, title: "Cannot delete", body: "That backup no longer exists." };

  if (backup.state === "LOCKED") {
    return {
      ok: false,
      title: "Backup is locked",
      body: `${backup.name} is retained indefinitely. Unlock it before deleting.`,
    };
  }

  const reached = await reach(user, backup.server.slug, "server.backup.write");
  /* A node that has gone away must not make its backups undeletable
     records forever — but the bytes stay behind, and the message says
     so rather than implying they are gone. */
  const orphaned = !reached.ok;

  if (!orphaned && backup.artifact) {
    try {
      await reached.runtime.backups.remove(reached.ref, backup.artifact);
    } catch (error) {
      const failure = asPlatformError(error);
      if (failure.code !== "NOT_FOUND") {
        return { ok: false, title: "Cannot delete", body: failure.message };
      }
    }
  }

  await db.backup.delete({ where: { id: backupId } });
  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "backup.deleted",
      target: backup.name,
      tone: "DANGER",
      userId: user.id,
      serverId: backup.serverId,
    },
  });

  return {
    ok: true,
    tone: "warning",
    title: "Backup deleted",
    body: orphaned
      ? `${backup.name} is gone from the panel. Its archive is still on the node, which could not be reached.`
      : `${backup.name} is gone. This cannot be undone.`,
  };
}

/** Marks a backup as kept indefinitely, or returns it to the retention policy. */
export async function setBackupLockOp(user: User, backupId: string, locked: boolean): Promise<OpResult> {
  const backup = await db.backup.findUnique({ where: { id: backupId }, include: { server: true } });
  if (!backup) return { ok: false, title: "Cannot change", body: "That backup no longer exists." };

  if (!can(user, "server.backup.write", backup.server.ownerId)) {
    return { ok: false, title: "Not permitted", body: "You cannot manage this server's backups." };
  }

  await db.backup.update({
    where: { id: backupId },
    data: { state: locked ? "LOCKED" : "COMPLETE", keepUntil: null },
  });
  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: locked ? "backup.locked" : "backup.unlocked",
      target: backup.name,
      tone: locked ? "INFO" : "MUTED",
      userId: user.id,
      serverId: backup.serverId,
    },
  });

  return {
    ok: true,
    tone: "success",
    title: locked ? "Backup locked" : "Backup unlocked",
    body: locked
      ? `${backup.name} is now kept indefinitely and skipped by retention.`
      : `${backup.name} follows the retention policy again.`,
  };
}

/** Refuses an operation on a server that has no node to reach. */
export function requireArtifact(backup: { artifact: string | null; name: string }): string {
  if (!backup.artifact) {
    throw new PlatformError("NOT_FOUND", `${backup.name} has no archive behind it.`);
  }
  return backup.artifact;
}
