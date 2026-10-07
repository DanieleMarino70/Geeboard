import "server-only";
import type { Server, User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import { asPlatformError, PlatformError } from "@/domain/errors";
import { findGame } from "@/domain/games/registry";
import { runtimeFor } from "@/domain/runtime/docker";
import type { IGameRuntime, RuntimeRef } from "@/domain/runtime/types";
import { waitForSave } from "@/domain/servers/save";
import { stopGracefully } from "@/domain/servers/shutdown";
import { PLATFORM_OWNED } from "@/domain/servers/state";
import { judgeArchive, summariseVerification, type ArchiveFinding } from "./backup-rules";
import { db } from "@/lib/db";
import { claimServer } from "./operations";
import type { OpResult } from "./server-ops";
import { archiveKey, deleteObject, downloadUrl, headObject, offsiteTarget, uploadUrl } from "./storage-ops";

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

/* Why reaching a server's archives failed.

   The distinction is load-bearing. "The node is not answering" is a
   reason to let an operator tidy up a record whose bytes are out of
   reach; "you are not allowed" is not, and collapsing the two into one
   failure is how a refusal turns into a delete. */
type Unreachable = "missing" | "forbidden" | "detached";

async function reach(
  user: User,
  slug: string,
  need: "server.backup.read" | "server.backup.write",
): Promise<
  | { ok: true; server: ServerWithNode; runtime: IGameRuntime; ref: RuntimeRef }
  | { ok: false; kind: Unreachable; result: OpResult }
> {
  const server = await db.server.findUnique({
    where: { slug },
    include: { node: { select: { name: true, daemonUrl: true, daemonToken: true } } },
  });
  if (!server) {
    return {
      ok: false,
      kind: "missing",
      result: { ok: false, title: "Cannot back up", body: "That server no longer exists." },
    };
  }

  if (!can(user, need, server.ownerId)) {
    return {
      ok: false,
      kind: "forbidden",
      result: { ok: false, title: "Not permitted", body: "You cannot manage this server's backups." },
    };
  }

  const runtime = runtimeFor(server.node);
  if (!runtime) {
    return {
      ok: false,
      kind: "detached",
      result: {
        ok: false,
        title: "No agent on this node",
        body: `${server.node.name} has no agent attached, so there is nothing to archive.`,
      },
    };
  }

  return { ok: true, server, runtime, ref: { serverId: server.id, runtimeId: server.runtimeId } };
}

/* A backup whose server has been deleted keeps what it needs to stay
   useful: the id its object key was built from, and the name of what it
   was a backup of. */
type Detachable = { serverId: string | null; originServerId: string | null; originServerName: string | null };

/** The server id in an archive's object key: its server's, or the one it had. */
export function keyServerId(backup: Detachable): string {
  const id = backup.serverId ?? backup.originServerId;
  if (!id) throw new PlatformError("NOT_FOUND", "This backup no longer says which server it was taken from.");
  return id;
}

export function backupOriginName(backup: Detachable & { server?: { name: string } | null }): string {
  return backup.server?.name ?? backup.originServerName ?? "a deleted server";
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
  trigger?: "MANUAL" | "SCHEDULED" | "PRE_UPDATE" | "PRE_DELETE";
  /** Skip the console flush. Only for a server that is already stopped. */
  skipQuiesce?: boolean;
  /* Where the archive ends up. LOCAL is the node's own disk; S3 is the
     workspace's bucket, and the archive leaves the node once it is
     there. Absent: a scheduled backup follows the storage setting, and
     anything else stays local — a pre-update backup is a rollback
     point, which wants to be on the node it rolls back. */
  store?: "LOCAL" | "S3";
  /** What the archive is called, before the date. "manual" or "auto" unless told. */
  prefix?: string;
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
  const name = await freeName(server.id, options.prefix ?? (trigger === "MANUAL" ? "manual" : "auto"));

  /* Off-site is decided before anything is archived, so a bucket that
     is not there is a refusal now and not a local archive nobody asked
     for. */
  const offsite = await offsiteTarget();
  const store: "LOCAL" | "S3" =
    options.store ?? (trigger === "SCHEDULED" && offsite?.scheduledOffsite ? "S3" : "LOCAL");
  if (store === "S3" && !offsite) {
    return { ok: false, title: "No off-site storage", body: "Configure a bucket on the Backups page first." };
  }

  /* The server is taken before anything is sent to it, by one compare-and-set (lib/operations.ts). Of two backups that begin together,
     or a backup and an update, exactly one gets it and the other is told what has it: that used to be a read and then a write, and
     the second of two backups left the server "Backing up" for good. Before the world is told to save, too: a refusal after that
     would have left a game with its saving paused. BACKING_UP is platform-owned, so reconciliation will not overwrite it while the
     archive runs, and the operator can see why the server is briefly not answering the usual questions. */
  const claim = await claimServer(server.id, "backup");
  if (!claim.ok) return { ok: false, title: "Busy", body: claim.sentence };
  const stateBefore = claim.stateBefore;

  /* Flushing the world to disk first is the difference between a backup
     and a copy of a world halfway through a save. Every game definition
     that has a save command names it; one that does not gets a best
     effort and a slightly less certain archive. */
  const game = server.gameId ? findGame(server.gameId) : undefined;
  const saveCommand = game?.console.saveCommand;
  const resumeCommand = game?.console.resumeCommand;

  let quiesced = false;
  let resumed = false;
  /* Whatever happens to the archive, a game whose save was paused for it
     gets its saving back. Sent from `finally` below, because a failed
     archive is exactly when nobody is thinking about the world's saves. Once. */
  const resume = async () => {
    if (resumed) return;
    resumed = true;
    if (quiesced && resumeCommand) await runtime.sendCommand(ref, resumeCommand).catch(() => {});
  };

  const record = await db.backup.create({
    data: { serverId: server.id, name, sizeBytes: BigInt(0), trigger, state: "RUNNING" },
  });

  /* The archive, once the node has written one, so that a failure after that
     point can do something about it. A failed off-site upload used to leave a
     whole archive on the node that no row pointed at, for good. */
  let archive: Awaited<ReturnType<typeof runtime.backups.create>> | undefined;
  let uploadFailure: string | undefined;

  try {
    if (!options.skipQuiesce && saveCommand && server.state === "RUNNING" && server.runtimeId) {
      const asked = new Date();
      quiesced = await runtime.sendCommand(ref, saveCommand).then(
        () => true,
        // A server that will not take a command is still worth archiving;
        // it just means the archive is a little less certain.
        () => false,
      );
      const ready = game?.console.saveReady;
      if (quiesced && ready) {
        await waitForSave(runtime, ref, ready, asked);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }

    archive = await runtime.backups.create(ref, `${server.slug}-${name}`).finally(resume);

    /* Off-site: the node is handed a signed URL and streams the archive
       up; once the bucket has it, the local copy goes, so the row means
       one thing — the bytes are in the bucket. The row keeps the
       artifact's name; the object key is derived from the server and the
       name, so a bucket listing reads like the panel's own layout. */
    let durationMs = archive.durationMs;
    let kept: "LOCAL" | "S3" = store;
    if (store === "S3" && offsite) {
      const key = archiveKey(offsite.prefix, server.id, archive.artifact);
      /* Twice, with the same archive: an uplink that dropped for a moment is
         the ordinary way an upload fails, and the archive is already made. */
      const send = async () => {
        const sent = await runtime.backups.upload(ref, archive!.artifact, uploadUrl(offsite, key));
        if (sent.sizeBytes !== archive!.sizeBytes) {
          throw new PlatformError("RUNTIME_REJECTED", "the bucket took a different number of bytes than the archive has");
        }
        return sent;
      };
      try {
        const sent = await send().catch(() => send());
        durationMs += sent.durationMs;
        await runtime.backups.remove(ref, archive.artifact).catch(() => {});
      } catch (error) {
        /* The archive is whole and verified; it is the off-site copy that
           failed. Keeping it as a local backup is worth more than a failed row
           beside an archive nobody can reach, so that is what it becomes, and the
           result says so. */
        uploadFailure = asPlatformError(error).message;
        kept = "LOCAL";
      }
    }

    await db.backup.update({
      where: { id: record.id },
      data: {
        state: "COMPLETE",
        sizeBytes: BigInt(archive.sizeBytes),
        checksum: archive.checksum,
        store: kept,
        artifact: archive.artifact,
        durationMs,
      },
    });
    await db.server.update({ where: { id: server.id }, data: { state: stateBefore } });

    const where = kept === "S3" ? `in ${offsite!.bucket}` : `on ${server.node.name}`;
    const warnings = archive.warnings ?? [];
    await db.activityEvent.create({
      data: {
        actor: user.name,
        action: "backup.created",
        target: name,
        tone: uploadFailure || warnings.length > 0 ? "WARNING" : "SUCCESS",
        userId: user.id,
        serverId: server.id,
        changes: {
          Size: { from: "—", to: `${(archive.sizeBytes / 1024 ** 3).toFixed(2)} GB` },
          Took: { from: "—", to: `${Math.round(durationMs / 1000)}s` },
          Where: { from: "—", to: where },
          ...(uploadFailure ? { "Off-site copy": { from: "—", to: `failed: ${uploadFailure}` } } : {}),
          ...(warnings.length > 0 ? { Changed: { from: "—", to: warnings.slice(0, 5).join("; ") } } : {}),
        },
      },
    });

    // A backup that is whole but not quite what was asked for says so in its own sentence.
    const notes = [
      uploadFailure ? `The off-site copy failed (${uploadFailure}), so the archive is kept on ${server.node.name} instead.` : null,
      warnings.length > 0 ? `${warnings.length} file${warnings.length === 1 ? "" : "s"} changed while it was being archived: ${warnings.slice(0, 3).join("; ")}${warnings.length > 3 ? "…" : ""}.` : null,
    ].filter(Boolean);
    return {
      ok: true,
      tone: notes.length > 0 ? "warning" : "success",
      title: uploadFailure ? "Backup kept on the node" : "Backup complete",
      body: `${name} · ${(archive.sizeBytes / 1024 ** 3).toFixed(2)} GB in ${Math.round(durationMs / 1000)}s, ${where}.${notes.length > 0 ? ` ${notes.join(" ")}` : ""}`,
      backupId: record.id,
    };
  } catch (error) {
    const failure = asPlatformError(error);
    // A save paused for the archive, and an error before the archive began to be made: the game gets its saving back all the same.
    await resume();
    /* An archive the node wrote and nothing took ownership of: removed now,
       and if the node will not answer, named on the row so that deleting the
       row or the cleanup task can remove it later. */
    let leftOnNode: string | undefined;
    if (archive) {
      const gone = await runtime.backups.remove(ref, archive.artifact).then(() => true, () => false);
      if (!gone) leftOnNode = archive.artifact;
    }
    /* A failed backup is recorded as failed rather than deleted. A row
       that vanishes leaves an operator believing the backup never
       started; one marked FAILED tells them it did and did not finish. */
    // With the reason, so the backups table can say why and not only that.
    await db.backup.update({
      where: { id: record.id },
      data: { state: "FAILED", error: failure.message, ...(leftOnNode ? { store: "LOCAL" as const, artifact: leftOnNode } : {}) },
    });
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
export async function restoreBackupOp(
  user: User,
  backupId: string,
  options: { into?: string; inPlace?: boolean } = {},
): Promise<OpResult> {
  const backup = await db.backup.findUnique({ where: { id: backupId }, include: { server: true } });
  if (!backup) return { ok: false, title: "Cannot restore", body: "That backup no longer exists." };

  /* Where it goes. Its own server, unless that is gone — then it has to
     be told, and it may only be a server of the game the archive was
     taken from: a Terraria world unpacked over a Minecraft server is a
     server with neither. Only an off-site archive can travel, because a
     local one lies in its own server's directory on its own node. */
  const foreign = Boolean(options.into) && options.into !== backup.server?.slug;
  if (!backup.server && !options.into) {
    return {
      ok: false,
      title: "Restore into which server?",
      body: `${backupOriginName(backup)} was deleted. Choose a server of the same game to restore ${backup.name} into.`,
    };
  }
  if (foreign && backup.store !== "S3") {
    return { ok: false, title: "Cannot restore there", body: `${backup.name} is on its own node, not in the bucket, so it can only go back where it came from.` };
  }
  if (!can(user, "server.backup.write", backup.server?.ownerId ?? backup.originOwnerId)) {
    return { ok: false, title: "Not permitted", body: "You cannot manage this backup." };
  }

  // Before the node is asked anything: the wrong game is wrong whatever the node says.
  if (foreign) {
    const target = await db.server.findUnique({ where: { slug: options.into! }, select: { name: true, gameId: true } });
    const fromGame = backup.server?.gameId ?? backup.originGameId;
    if (target && (!fromGame || fromGame !== target.gameId)) {
      return {
        ok: false,
        title: "A different game",
        body: `${backup.name} is a backup of ${backupOriginName(backup)}, which is not the game ${target.name} runs.`,
      };
    }
  }

  const reached = await reach(user, options.into ?? backup.server!.slug, "server.backup.write");
  if (!reached.ok) return reached.result;
  const { server, runtime, ref } = reached;
  /* The archive is fetched into the target's own backup directory under
     its own name and removed afterwards. A server that reused a deleted
     one's address can have a local archive of exactly that name, and it
     would be overwritten and then removed. */
  if (foreign && backup.artifact) {
    const clash = await db.backup.count({ where: { serverId: server.id, store: "LOCAL", artifact: backup.artifact } });
    if (clash > 0) {
      return { ok: false, title: "Cannot restore there", body: `${server.name} has a local backup whose archive has the same name, and fetching this one would overwrite it. Delete that backup first, or restore into another server.` };
    }
  }

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

  // Taken, or refused with what has it: a restore under an update, or beside a backup, is how a world becomes two halves of different saves.
  const claim = await claimServer(server.id, "restore");
  if (!claim.ok) return { ok: false, title: "Busy", body: claim.sentence };

  /* Whether the node has been asked to replace the world yet. A failure
     before that — stopping the server, bringing an archive down from the
     bucket — has not touched it, whatever the node would say. */
  let touched = false;

  try {
    if (wasRunning && server.runtimeId) {
      // Saved and exited by its own command: the world on disk is the one being replaced.
      const dialect = server.gameId ? findGame(server.gameId)?.console : undefined;
      await stopGracefully(runtime, ref, dialect, { graceSeconds: 30 });
    }

    /* An off-site archive comes down to the node first, hashed on the
       way and refused if it does not match — onto whichever node the
       server is on now, which is what makes a bucket a way to move a
       world between machines. The copy is removed again afterwards. */
    let fetched = false;
    if (backup.store === "S3") {
      const offsite = await offsiteTarget();
      if (!offsite) {
        throw new PlatformError("NOT_FOUND", `${backup.name} is in a bucket the panel is no longer configured for`);
      }
      // The key was built from the server the archive was taken from.
      const key = archiveKey(offsite.prefix, keyServerId(backup), backup.artifact);
      await runtime.backups.download(ref, backup.artifact, downloadUrl(offsite, key), backup.checksum ?? undefined);
      fetched = true;
    }

    /* The checksum recorded when the archive was written, checked again
       before a single byte is replaced. A backup nobody verified is a
       hope, and this is the moment it stops being one. */
    touched = true;
    const result = await runtime.backups
      .restore(ref, backup.artifact, backup.checksum ?? undefined, { inPlace: options.inPlace })
      .finally(async () => {
        if (fetched) await runtime.backups.remove(ref, backup.artifact!).catch(() => {});
      });

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
    /* What state the world is in, from the node's own word when it gave one.
       A node before 0.9 gave none, and unpacked over the world after emptying
       it, so for one the honest answer to a failure mid-restore is "unknown". */
    const said = (failure.details as { agentCode?: string } | undefined)?.agentCode;
    const world: "unchanged" | "incomplete" | "unknown" =
      !touched || said === "restore-untouched" ? "unchanged" : said === "restore-incomplete" ? "incomplete" : "unknown";

    await db.activityEvent.create({
      data: {
        actor: user.name,
        action: "backup.restore.failed",
        target: backup.name,
        tone: world === "unchanged" ? "WARNING" : "DANGER",
        userId: user.id,
        serverId: server.id,
        changes: {
          Reason: { from: "—", to: failure.message },
          World: { from: "—", to: world },
        },
      },
    });

    if (world === "unchanged") {
      /* The server goes back to what it was: a restore that never began is not
         a reason to leave a running server down, or to call a healthy one
         broken, which is what this used to say of every failure. */
      const back = wasRunning && server.runtimeId ? await runtime.start(ref).then(() => true, () => false) : false;
      await db.server.update({
        where: { id: server.id },
        data: { state: back ? "STARTING" : "STOPPED", lastError: null },
      });
      const sentence = /Nothing was changed/.test(failure.message)
        ? failure.message
        : `${failure.message}. Nothing was changed: ${server.name}'s world is exactly as it was`;
      return {
        ok: false,
        title: "Restore failed, nothing changed",
        body: `${sentence}. ${server.name} ${back ? "is starting again" : "is stopped"}.`,
      };
    }

    await db.server.update({
      where: { id: server.id },
      data: { state: "ERROR", lastError: `Restore failed: ${failure.message}` },
    });
    return {
      ok: false,
      title: "Restore failed",
      body:
        world === "incomplete"
          ? `${failure.message}. ${server.name} is stopped; restore again before starting it.`
          : `${failure.message}. The node did not say what state the world is in. ${server.name} is stopped and needs looking at: restore again, or check its files, before starting it.`,
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

  /* A backup whose server is gone is off-site by construction, and
     needs no node: the permission is its old owner's, and the bucket is
     the panel's to reach. */
  const reached: Awaited<ReturnType<typeof reach>> = backup.server
    ? await reach(user, backup.server.slug, "server.backup.write")
    : can(user, "server.backup.write", backup.originOwnerId)
      ? { ok: false, kind: "detached", result: { ok: false, title: "No server", body: "" } }
      : { ok: false, kind: "forbidden", result: { ok: false, title: "Not permitted", body: "You cannot manage this backup." } };

  /* A node that has gone away must not make its backups undeletable
     records forever — but the bytes stay behind, and the message says
     so rather than implying they are gone.

     Only *that* failure. Not being allowed is a refusal, and treating
     it as an orphan would let anyone tidy away anyone's backup: the
     record would go, which is most of what deleting a backup means. */
  if (!reached.ok && reached.kind !== "detached") return reached.result;
  let orphaned = !reached.ok;

  /* An off-site archive is the panel's to remove, node or no node. With
     the bucket no longer configured the row goes and the object stays,
     and the message says so. */
  if (backup.store === "S3" && backup.artifact) {
    const offsite = await offsiteTarget();
    if (offsite) {
      try {
        await deleteObject(offsite, archiveKey(offsite.prefix, keyServerId(backup), backup.artifact));
      } catch (error) {
        return { ok: false, title: "Cannot delete", body: asPlatformError(error).message };
      }
      orphaned = false;
    } else {
      orphaned = true;
    }
  } else if (reached.ok && backup.artifact) {
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
      ? backup.store === "S3"
        ? `${backup.name} is gone from the panel. Its archive is still in the bucket, which is no longer configured here.`
        : `${backup.name} is gone from the panel. Its archive is still on the node, which could not be reached.`
      : `${backup.name} is gone. This cannot be undone.`,
  };
}

/** Marks a backup as kept indefinitely, or returns it to the retention policy. */
export async function setBackupLockOp(user: User, backupId: string, locked: boolean): Promise<OpResult> {
  const backup = await db.backup.findUnique({ where: { id: backupId }, include: { server: true } });
  if (!backup) return { ok: false, title: "Cannot change", body: "That backup no longer exists." };

  if (!can(user, "server.backup.write", backup.server?.ownerId ?? backup.originOwnerId)) {
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

/* Reads a server's archives back where they lie, and writes down what
   it found.

   `verifyArchive` has been on the node since backups copied bytes, and
   the only thing that ever called it was a restore — the worst moment to
   find out. This is the scheduled look in between, and the button beside
   one backup.

   A local archive is re-hashed by its node. An off-site one is asked
   after with a HEAD — present, at the size that was uploaded — and only
   pulled down and re-hashed when `download` says so, because that costs
   the archive's whole size in egress on every run. The copy fetched for
   it is removed again whatever happens.

   What it never does is call an archive damaged because it could not be
   looked at. A node that is down leaves the row as it was. */
export async function verifyBackupsOp(
  user: User,
  slug: string,
  options: { download?: boolean; backupId?: string } = {},
): Promise<OpResult & { counts?: { intact: number; damaged: number; unchecked: number } }> {
  const server = await db.server.findUnique({
    where: { slug },
    include: { node: { select: { name: true, daemonUrl: true, daemonToken: true } } },
  });
  if (!server) return { ok: false, title: "Cannot verify", body: "That server no longer exists." };
  if (!can(user, "server.backup.write", server.ownerId)) {
    return { ok: false, title: "Not permitted", body: "You cannot manage this server's backups." };
  }
  /* A restore or a move is fetching and removing archives under these
     same names; reading them now would be reading a moving thing. */
  if (PLATFORM_OWNED.has(server.state)) {
    return { ok: false, title: "Busy", body: `${server.name} is mid-operation; its archives are checked next time.` };
  }

  const backups = await db.backup.findMany({
    where: {
      serverId: server.id,
      state: { in: ["COMPLETE", "LOCKED"] },
      artifact: { not: null },
      ...(options.backupId ? { id: options.backupId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  if (backups.length === 0) {
    return {
      ok: true,
      tone: "success",
      title: "Nothing to verify",
      body: options.backupId ? "That backup has no archive to read." : `${server.name} has no archives yet.`,
      counts: { intact: 0, damaged: 0, unchecked: 0 },
    };
  }

  const runtime = runtimeFor(server.node);
  const ref: RuntimeRef = { serverId: server.id, runtimeId: server.runtimeId };
  const offsite = await offsiteTarget().catch(() => null);
  const counts = { intact: 0, damaged: 0, unchecked: 0 };

  for (const backup of backups) {
    const artifact = backup.artifact!;
    let finding: ArchiveFinding;

    try {
      if (backup.store === "S3") {
        if (!offsite) {
          finding = { kind: "unreachable", reason: "the panel is no longer configured for its bucket" };
        } else {
          const key = archiveKey(offsite.prefix, server.id, artifact);
          const listed = await headObject(offsite, key);
          if (!listed) finding = { kind: "missing", where: "bucket" };
          else if (!options.download || listed.sizeBytes !== Number(backup.sizeBytes)) {
            finding = { kind: "listed", sizeBytes: listed.sizeBytes };
          } else if (!runtime) {
            finding = { kind: "unreachable", reason: `${server.node.name} has no agent to fetch it with` };
          } else {
            /* Down to the node, hashed by it, and gone again. The node
               refuses a download whose digest differs, so its own hash is
               asked for rather than its verdict — a refusal and a network
               failure must not look alike. */
            const fetched = await runtime.backups
              .download(ref, artifact, downloadUrl(offsite, key))
              .finally(() => runtime.backups.remove(ref, artifact).catch(() => {}));
            finding = { kind: "read", checksum: fetched.checksum, sizeBytes: fetched.sizeBytes };
          }
        }
      } else if (!runtime) {
        finding = { kind: "unreachable", reason: `${server.node.name} has no agent attached` };
      } else {
        finding = { kind: "read", ...(await runtime.backups.verify(ref, artifact)) };
      }
    } catch (error) {
      const failure = asPlatformError(error);
      finding =
        failure.code === "NOT_FOUND"
          ? { kind: "missing", where: backup.store === "S3" ? "bucket" : "node" }
          : { kind: "unreachable", reason: failure.message };
    }

    const verdict = judgeArchive(backup, finding);
    counts[verdict.status]++;
    if (verdict.status === "unchecked") continue;

    const error = verdict.status === "damaged" ? verdict.error : null;
    await db.backup.update({ where: { id: backup.id }, data: { verifiedAt: new Date(), verifyError: error } });

    /* Said once, when it is found — not again on every run while it
       stays that way, and said again as good news if it ever reads clean. */
    if (error && backup.verifyError !== error) {
      await db.activityEvent.create({
        data: {
          actor: user.name,
          action: "backup.damaged",
          target: backup.name,
          tone: "DANGER",
          userId: user.id,
          serverId: server.id,
          changes: { Found: { from: "—", to: error } },
        },
      });
    } else if (!error && backup.verifyError) {
      await db.activityEvent.create({
        data: {
          actor: user.name,
          action: "backup.verified.again",
          target: backup.name,
          tone: "SUCCESS",
          userId: user.id,
          serverId: server.id,
        },
      });
    }
  }

  const summary = summariseVerification(counts);
  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "backups.verified",
      target: server.name,
      tone: counts.damaged > 0 ? "DANGER" : "MUTED",
      userId: user.id,
      serverId: server.id,
      changes: { Archives: { from: "—", to: summary } },
    },
  });

  return {
    ok: counts.damaged === 0,
    tone: counts.unchecked > 0 ? "warning" : "success",
    title: counts.damaged > 0 ? "Damaged archives found" : "Archives verified",
    body: `${server.name}: ${summary}.`,
    counts,
  };
}

/* One backup, from its row. Somebody asking about one archive wants the
   whole answer, so an off-site one is fetched and re-hashed here rather
   than only asked after. */
export async function verifyBackupOp(user: User, backupId: string): Promise<OpResult> {
  const backup = await db.backup.findUnique({
    where: { id: backupId },
    include: { server: { select: { slug: true } } },
  });
  if (!backup) return { ok: false, title: "Cannot verify", body: "That backup no longer exists." };

  /* With its server gone there is no node to fetch it onto, so it is
     asked after in the bucket and no more — and the answer says so. */
  if (!backup.server) {
    if (!can(user, "server.backup.write", backup.originOwnerId)) {
      return { ok: false, title: "Not permitted", body: "You cannot manage this backup." };
    }
    const offsite = await offsiteTarget().catch(() => null);
    if (!offsite || !backup.artifact) {
      return { ok: false, title: "Could not be checked", body: "The panel is not configured for the bucket it is in." };
    }
    let finding: ArchiveFinding;
    try {
      const listed = await headObject(offsite, archiveKey(offsite.prefix, keyServerId(backup), backup.artifact));
      finding = listed ? { kind: "listed", sizeBytes: listed.sizeBytes } : { kind: "missing", where: "bucket" };
    } catch (error) {
      finding = { kind: "unreachable", reason: asPlatformError(error).message };
    }
    const verdict = judgeArchive(backup, finding);
    if (verdict.status === "unchecked") {
      return { ok: false, title: "Could not be checked", body: `${verdict.reason}. Nothing about ${backup.name} was changed.` };
    }
    const error = verdict.status === "damaged" ? verdict.error : null;
    await db.backup.update({ where: { id: backup.id }, data: { verifiedAt: new Date(), verifyError: error } });
    return error
      ? { ok: false, title: `${backup.name} is damaged`, body: error }
      : { ok: true, tone: "success", title: `${backup.name} is in the bucket`, body: "Present at the size that was uploaded. Its server is gone, so there is no node to re-hash it on; a restore checks the hash." };
  }

  const result = await verifyBackupsOp(user, backup.server.slug, { backupId, download: true });
  if (!result.counts) return result;

  const after = await db.backup.findUnique({ where: { id: backupId }, select: { verifyError: true } });
  if (result.counts.damaged > 0) {
    return { ok: false, title: `${backup.name} is damaged`, body: after?.verifyError ?? "It does not match what was written." };
  }
  // Nothing looked at is not "intact": a record with no archive behind it, or a node that was out.
  if (result.counts.unchecked > 0 || result.counts.intact === 0) {
    return {
      ok: false,
      title: "Could not be checked",
      body: backup.artifact
        ? `${backup.name} could not be read just now. Nothing about it was changed.`
        : `${backup.name} is a record with no archive behind it, so there is nothing to read.`,
    };
  }
  return { ok: true, tone: "success", title: `${backup.name} is intact`, body: "Read back and matched against the checksum taken when it was written." };
}

export function requireArtifact(backup: { artifact: string | null; name: string }): string {
  if (!backup.artifact) {
    throw new PlatformError("NOT_FOUND", `${backup.name} has no archive behind it.`);
  }
  return backup.artifact;
}
