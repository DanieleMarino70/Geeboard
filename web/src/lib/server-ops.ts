import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { EventTone, Role, Server, ServerState, User } from "@prisma/client";
import { asPlatformError } from "@/domain/errors";
import { findGame } from "@/domain/games/registry";
import { runtimeFor } from "@/domain/runtime/docker";
import type { RuntimeRef } from "@/domain/runtime/types";
import { restartGracefully, stopGracefully } from "@/domain/servers/shutdown";
import { mapRuntimeState } from "@/domain/servers/state";
import { createBackupOp, verifyBackupsOp } from "./backup-ops";
import { verifyDownloads } from "./backup-rules";
import { nextRun } from "./cron";
import { archiveKey, deleteObject, offsiteTarget } from "./storage-ops";
import { isSystemAccount } from "./system-user";
import {
  DEFAULT_LIMITS,
  SETTINGS_LABELS,
  validateSettings,
  type SettingsErrors,
  type SettingsInput,
  type SettingsLimits,
} from "./settings-rules";
import { scheduleSettle } from "./daemon-sim";
import { db } from "./db";

/* The lifecycle operations, as plain functions of (actor, slug).
   Server actions in app/actions/servers.ts are thin wrappers that
   resolve the signed-in user and revalidate; everything that decides
   what happens lives here, where it can be exercised directly. */

export type OpResult =
  | { ok: true; title: string; body: string; tone: "success" | "warning" }
  | { ok: false; title: string; body: string };

type Authorized = { ok: true; user: User; server: Server; node: NodeWithAgent };
type Denied = { ok: false; error: string };

type NodeWithAgent = {
  name: string;
  daemonUrl: string | null;
  daemonToken: string | null;
};

/* Owners and admins can act on anything; everyone else only on the
   servers they own. Moderators get console access but not lifecycle
   control — the split the permission editor in the design encodes. */
export async function authorize(user: User, slug: string): Promise<Authorized | Denied> {
  const server = await db.server.findUnique({
    where: { slug },
    include: { node: { select: { name: true, daemonUrl: true, daemonToken: true } } },
  });
  if (!server) return { ok: false, error: "That server no longer exists." };

  const privileged = user.role === "OWNER" || user.role === "ADMIN";
  if (!privileged && server.ownerId !== user.id) {
    return { ok: false, error: "You do not have permission to control this server." };
  }
  return { ok: true, user, server, node: server.node };
}

async function logEvent(
  actor: string,
  action: string,
  target: string,
  tone: EventTone,
  userId: string,
  serverId: string,
) {
  await db.activityEvent.create({ data: { actor, action, target, tone, userId, serverId } });
}


/* ── Driving the runtime ──────────────────────────────────────── */

/** How a server is addressed on its node. Never a container id alone. */
export function refFor(server: Pick<Server, "id" | "runtimeId">): RuntimeRef {
  return { serverId: server.id, runtimeId: server.runtimeId };
}

/* A node with no agent attached still has to be usable — the seeded
   workspace has no real machines behind it — so lifecycle actions fall
   back to the simulator. Which path ran is reported, never hidden. */
type Drive = { real: true; state: ServerState } | { real: false } | { failed: string };

async function driveRuntime(
  node: NodeWithAgent,
  server: Server,
  action: "start" | "stop" | "restart",
  graceSeconds = 30,
): Promise<Drive> {
  const runtime = runtimeFor(node);
  if (!runtime) return { real: false };
  /* A real node and no workload — removed outside the panel, or a failed
     rebuild. This used to fall through to the simulator, which set the
     server STARTING and a timer then called it RUNNING: a server with
     nothing behind it, reported up on a node that could have said
     otherwise. There is nothing to drive; it needs rebuilding. */
  if (!server.runtimeId) {
    return {
      failed: `${server.name} has no workload on ${node.name}. Rebuild it to run it again — its files are kept.`,
    };
  }

  const ref = refFor(server);
  // The game's own stop command, so a stop saves the world first.
  const dialect = server.gameId ? findGame(server.gameId)?.console : undefined;

  /* Asking a game to save and exit takes seconds, and a poll landing in
     that window would otherwise see a server stop that the panel had not
     yet said it asked for, and record it as news. */
  if (action !== "start") {
    await db.server.update({
      where: { id: server.id },
      data: { state: action === "stop" ? "STOPPING" : "STARTING" },
    });
  }

  try {
    const status =
      action === "start"
        ? await runtime.start(ref)
        : action === "stop"
          ? (await stopGracefully(runtime, ref, dialect, { graceSeconds })).status
          : await restartGracefully(runtime, ref, dialect, { graceSeconds });
    return { real: true, state: mapRuntimeState(status.state) };
  } catch (error) {
    if (action !== "start") {
      await db.server.update({ where: { id: server.id }, data: { state: server.state } }).catch(() => {});
    }
    return { failed: asPlatformError(error).message };
  }
}

export async function startServerOp(user: User, slug: string): Promise<OpResult> {
  const auth = await authorize(user, slug);
  if (!auth.ok) return { ok: false, title: "Cannot start", body: auth.error };
  const { server } = auth;

  if (server.state === "RUNNING" || server.state === "STARTING") {
    return { ok: false, title: "Already up", body: `${server.name} is ${server.state.toLowerCase()}.` };
  }

  const drive = await driveRuntime(auth.node, server, "start");
  if ("failed" in drive) {
    return { ok: false, title: "Cannot start", body: drive.failed };
  }

  if (drive.real) {
    await db.server.update({
      where: { id: server.id },
      data: { state: drive.state, startedAt: new Date() },
    });
  } else {
    await db.server.update({ where: { id: server.id }, data: { state: "STARTING" } });
    scheduleSettle(server.id, "STARTING", "RUNNING");
  }
  await logEvent(user.name, drive.real ? "started" : "started (simulated)", server.name, "ACCENT", user.id, server.id);

  /* A simulated result is a warning, never a success: it is the panel
     reporting that nothing happened anywhere, and a green toast saying
     "Starting" is how somebody comes to believe a server exists. */
  return drive.real
    ? {
        ok: true,
        tone: "success",
        title: `Starting ${server.name}`,
        body: `${auth.node.name} reports it ${drive.state === "RUNNING" ? "running" : drive.state.toLowerCase()}.`,
      }
    : {
        ok: true,
        tone: "warning",
        title: `Simulated start of ${server.name}`,
        body: `No agent on ${auth.node.name}, so nothing was started. The state shown is pretend.`,
      };
}

export async function stopServerOp(user: User, slug: string): Promise<OpResult> {
  const auth = await authorize(user, slug);
  if (!auth.ok) return { ok: false, title: "Cannot stop", body: auth.error };
  const { server } = auth;

  if (server.state === "STOPPED" || server.state === "STOPPING") {
    return { ok: false, title: "Already down", body: `${server.name} is ${server.state.toLowerCase()}.` };
  }

  const drive = await driveRuntime(auth.node, server, "stop");
  if ("failed" in drive) {
    return { ok: false, title: "Cannot stop", body: drive.failed };
  }

  if (drive.real) {
    await db.server.update({
      where: { id: server.id },
      data: { state: drive.state, startedAt: null, playersOn: 0, cpuPct: 0, ramPct: 0 },
    });
  } else {
    await db.server.update({ where: { id: server.id }, data: { state: "STOPPING" } });
    scheduleSettle(server.id, "STOPPING", "STOPPED");
  }
  await logEvent(user.name, drive.real ? "stopped" : "stopped (simulated)", server.name, "WARNING", user.id, server.id);

  return {
    ok: true,
    tone: "warning",
    title: drive.real ? "Stop requested" : `Simulated stop of ${server.name}`,
    body: drive.real
      ? `${auth.node.name} reports it ${drive.state.toLowerCase()}.`
      : `No agent on ${auth.node.name}, so nothing was stopped. The state shown is pretend.`,
  };
}

export async function restartServerOp(user: User, slug: string): Promise<OpResult> {
  const auth = await authorize(user, slug);
  if (!auth.ok) return { ok: false, title: "Cannot restart", body: auth.error };
  const { server } = auth;

  const drive = await driveRuntime(auth.node, server, "restart");
  if ("failed" in drive) {
    return { ok: false, title: "Cannot restart", body: drive.failed };
  }

  if (drive.real) {
    await db.server.update({
      where: { id: server.id },
      data: { state: drive.state, playersOn: 0, startedAt: new Date() },
    });
  } else {
    await db.server.update({ where: { id: server.id }, data: { state: "STARTING", playersOn: 0 } });
    scheduleSettle(server.id, "STARTING", "RUNNING");
  }
  await logEvent(user.name, drive.real ? "restarted" : "restarted (simulated)", server.name, "ACCENT", user.id, server.id);

  return drive.real
    ? {
        ok: true,
        tone: "success",
        title: `Restarting ${server.name}`,
        body: `${auth.node.name} restarted it; now ${drive.state.toLowerCase()}.`,
      }
    : {
        ok: true,
        tone: "warning",
        title: `Simulated restart of ${server.name}`,
        body: `No agent on ${auth.node.name}, so nothing was restarted. The state shown is pretend.`,
      };
}

/* ── Backups ──────────────────────────────────────────────────────
   Moved to backup-ops.ts when they stopped being records and started
   being archives. Re-exported here so the scheduler and the server
   actions keep one import, and so a reader following the lifecycle
   through this file is pointed at where the bytes are handled. */
export { deleteBackupOp, restoreBackupOp, setBackupLockOp, verifyBackupOp, verifyBackupsOp } from "./backup-ops";
export { createBackupOp };

export async function toggleTaskOp(user: User, taskId: string): Promise<OpResult> {
  const task = await db.scheduledTask.findUnique({
    where: { id: taskId },
    include: { server: true },
  });
  if (!task) return { ok: false, title: "Cannot change", body: "That task no longer exists." };

  const auth = await authorize(user, task.server.slug);
  if (!auth.ok) return { ok: false, title: "Cannot change", body: auth.error };

  const enabled = !task.enabled;
  await db.scheduledTask.update({
    where: { id: taskId },
    data: { enabled, nextRunAt: enabled ? nextRun(task.cron) : null },
  });
  await logEvent(
    user.name,
    enabled ? "enabled a task" : "paused a task",
    task.name,
    enabled ? "ACCENT" : "MUTED",
    user.id,
    task.serverId,
  );

  return {
    ok: true,
    tone: "success",
    title: enabled ? `${task.name} enabled` : `${task.name} paused`,
    body: enabled
      ? `Next run ${nextRun(task.cron)?.toUTCString() ?? "unknown"}.`
      : "It will not fire again until you re-enable it.",
  };
}

/* Carrying out one scheduled task.

   Shared by the "run now" button and the scheduler process, deliberately:
   a task that behaves differently depending on who asked for it is a
   task nobody can test by pressing the button.

   The actor is a real user for a manual run and a system user for a
   scheduled one, which is what keeps the audit log honest about who
   caused something. */
export async function runTask(
  user: User,
  taskId: string,
): Promise<OpResult & { skipped?: boolean }> {
  const task = await db.scheduledTask.findUnique({
    where: { id: taskId },
    include: { server: { include: { node: { select: { name: true, daemonUrl: true, daemonToken: true } } } } },
  });
  if (!task) return { ok: false, title: "Cannot run", body: "That task no longer exists." };

  const auth = await authorize(user, task.server.slug);
  if (!auth.ok) return { ok: false, title: "Cannot run", body: auth.error };

  const finish = async (result: OpResult, outcome: "SUCCEEDED" | "FAILED" | "SKIPPED") => {
    await db.scheduledTask.update({
      where: { id: taskId },
      data: {
        lastRunAt: new Date(),
        lastResult: outcome,
        // Recomputed from the expression each run, so a task cannot
        // drift into firing at a time nobody asked for.
        nextRunAt: nextRun(task.cron),
      },
    });
    return result;
  };

  switch (task.kind) {
    case "BACKUP": {
      const result = await createBackupOp(user, task.server.slug, { trigger: "SCHEDULED" });
      return finish(result, result.ok ? "SUCCEEDED" : "FAILED");
    }

    case "RESTART": {
      const result = await restartServerOp(user, task.server.slug);
      return finish(result, result.ok ? "SUCCEEDED" : "FAILED");
    }

    case "BROADCAST":
    case "COMMAND": {
      /* A broadcast is a command with the game's own wording around it,
         which is why the definition carries the template: "say %s" for
         Minecraft, `servermsg "%s"` for Zomboid. A game with no console
         language cannot do either, and says so. */
      const game = task.server.gameId ? findGame(task.server.gameId) : undefined;
      const payload = task.payload?.trim() ?? "";

      if (!payload) {
        return finish(
          { ok: false, title: "Nothing to send", body: `${task.name} has no command to run.` },
          "SKIPPED",
        );
      }

      const command =
        task.kind === "BROADCAST" && game?.console.broadcastCommand
          ? game.console.broadcastCommand.replace("%s", payload)
          : payload;

      const result = await sendConsoleCommandOp(user, task.server.slug, command);
      return finish(result, result.ok ? "SUCCEEDED" : "FAILED");
    }

    case "VERIFY": {
      const result = await verifyBackupsOp(user, task.server.slug, { download: verifyDownloads(task.payload) });
      return finish(result, result.ok ? "SUCCEEDED" : "FAILED");
    }

    case "CLEANUP": {
      const removed = await pruneBackups(task.serverId, retentionFrom(task.payload));
      await logEvent(user.name, "pruned backups", task.name, "MUTED", user.id, task.serverId);
      return finish(
        {
          ok: true,
          tone: "success",
          title: `${task.name} ran`,
          body:
            removed === 0
              ? "Nothing was old enough to remove."
              : `${removed} backup${removed === 1 ? "" : "s"} removed.`,
        },
        "SUCCEEDED",
      );
    }
  }
}

/** Kept for the existing call sites; `runTask` is the name that means it. */
export const runTaskNowOp = runTask;

/* How many backups to keep, from a task's payload.

   A payload of "keep 7" or plain "7" is a count. Anything unreadable
   falls back to a conservative default rather than to zero — a cleanup
   task that misreads its own configuration must not delete everything. */
function retentionFrom(payload: string | null): number {
  const found = /\d+/.exec(payload ?? "");
  const parsed = found ? Number(found[0]) : NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 365 ? parsed : 7;
}

/* Removes all but the newest `keep` backups.

   Locked ones are never counted or removed: locking a backup is an
   operator saying "this one specifically", and a retention policy that
   overrode that would make locking meaningless. */
export async function pruneBackups(serverId: string, keep: number): Promise<number> {
  const backups = await db.backup.findMany({
    where: { serverId, state: { not: "LOCKED" } },
    orderBy: { createdAt: "desc" },
    include: { server: { include: { node: { select: { name: true, daemonUrl: true, daemonToken: true } } } } },
  });

  const doomed = backups.slice(keep);
  if (doomed.length === 0) return 0;

  let removed = 0;
  const offsite = await offsiteTarget();
  for (const backup of doomed) {
    /* An off-site archive is removed from the bucket by the panel; with
       the bucket no longer configured it is left, row and all, rather
       than orphaned in a store nobody can reach from here. */
    if (backup.store === "S3" && backup.artifact) {
      if (!offsite) continue;
      const gone = await deleteObject(offsite, archiveKey(offsite.prefix, serverId, backup.artifact))
        .then(() => true)
        .catch(() => false);
      if (!gone) continue;
      await db.backup.delete({ where: { id: backup.id } });
      removed++;
      continue;
    }
    // Asked for by server id, so every row here has its server.
    if (!backup.server) continue;
    const runtime = runtimeFor(backup.server.node);
    if (runtime && backup.artifact) {
      // A node that cannot be reached leaves the bytes behind; the row
      // is kept too, so the archive is not orphaned without a record.
      const gone = await runtime.backups
        .remove({ serverId, runtimeId: backup.server.runtimeId }, backup.artifact)
        .then(() => true)
        .catch(() => false);
      if (!gone) continue;
    }
    await db.backup.delete({ where: { id: backup.id } });
    removed++;
  }
  return removed;
}

/* ── Server settings ──────────────────────────────────────────── */

export type { SettingsInput } from "./settings-rules";

/* The limits a server's settings are checked against: its game's own
   bounds, and what its node has left once every other server there is
   counted. Raising a limit past the node's memory used to be accepted. */
export async function settingsLimitsFor(server: Pick<Server, "id" | "gameId" | "nodeId">): Promise<SettingsLimits> {
  const game = server.gameId ? findGame(server.gameId) : undefined;
  const [node, others] = await Promise.all([
    db.node.findUnique({ where: { id: server.nodeId }, select: { ramTotal: true } }),
    db.server.aggregate({ _sum: { memoryLimit: true }, where: { nodeId: server.nodeId, id: { not: server.id } } }),
  ]);
  return {
    memoryGb: game?.limits.memoryGb ?? DEFAULT_LIMITS.memoryGb,
    cpuLimit: game?.limits.cpuLimit ?? DEFAULT_LIMITS.cpuLimit,
    memoryAvailableGb: node ? Math.max(0, node.ramTotal - (others._sum.memoryLimit ?? 0)) : null,
    /* What the game asks for, which the form warns about rather than
       refuses — the lower bound it enforces is the platform's. */
    recommended: game
      ? { memoryGb: game.requirements.memoryGbMin, cpuLimit: game.requirements.cpuPctMin }
      : null,
  };
}

export async function updateServerSettingsOp(
  user: User,
  slug: string,
  input: SettingsInput,
): Promise<OpResult & { rebuildRequired?: boolean; errors?: SettingsErrors }> {
  const auth = await authorize(user, slug);
  if (!auth.ok) return { ok: false, title: "Cannot save", body: auth.error };
  const { server, node } = auth;

  const limits = await settingsLimitsFor(server);
  // A limit that was already over the node's capacity is not this save's doing.
  if (limits.memoryAvailableGb !== null && input.memoryLimit === server.memoryLimit) {
    limits.memoryAvailableGb = Math.max(limits.memoryAvailableGb, server.memoryLimit);
  }
  const errors = validateSettings(input, limits);
  if (Object.keys(errors).length > 0) {
    return { ok: false, title: "Check the form", body: Object.values(errors)[0]!, errors };
  }

  const current: SettingsInput = {
    name: server.name,
    host: server.host,
    memoryLimit: server.memoryLimit,
    cpuLimit: server.cpuLimit,
    restartPolicy: server.restartPolicy,
    maxRestarts: server.maxRestarts,
  };
  const next: SettingsInput = { ...input, name: input.name.trim(), host: input.host.trim().toLowerCase() };

  const changes: Record<string, { from: string | number; to: string | number }> = {};
  for (const key of Object.keys(current) as Array<keyof SettingsInput>) {
    if (current[key] !== next[key]) changes[SETTINGS_LABELS[key]] = { from: current[key], to: next[key] };
  }
  if (Object.keys(changes).length === 0) {
    return { ok: false, title: "Nothing to save", body: "No values were changed." };
  }

  if (next.host !== server.host) {
    const taken = await db.server.findFirst({
      where: { host: next.host, id: { not: server.id } },
      select: { name: true },
    });
    if (taken) {
      return {
        ok: false,
        title: "Address in use",
        body: `${next.host} is already the address of ${taken.name}.`,
        errors: { host: `Already the address of ${taken.name}.` },
      };
    }
  }

  await db.server.update({
    where: { id: server.id },
    data: {
      name: next.name,
      host: next.host,
      memoryLimit: next.memoryLimit,
      cpuLimit: next.cpuLimit,
      restartPolicy: next.restartPolicy,
      maxRestarts: next.maxRestarts,
      /* Loosening the policy or raising the ceiling is an operator
         saying "try again", so the attempt count starts over — otherwise
         a server that had already given up would stay down. */
      restartAttempts: 0,
    },
  });

  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "server.settings.updated",
      target: next.name,
      tone: "ACCENT",
      userId: user.id,
      serverId: server.id,
      changes,
    },
  });

  /* Resource limits are fixed when a workload is created. This used to
     say they applied "on the next restart", which they do not — a
     restart reuses the workload. A rebuild makes a new one. */
  const limitsChanged = next.memoryLimit !== current.memoryLimit || next.cpuLimit !== current.cpuLimit;
  const rebuildRequired = limitsChanged && Boolean(runtimeFor(node)) && Boolean(server.runtimeId);
  const count = Object.keys(changes).length;
  return {
    ok: true,
    tone: rebuildRequired ? "warning" : "success",
    title: "Settings saved",
    body: rebuildRequired
      ? `${count} change${count === 1 ? "" : "s"} saved. The new resource limits take effect when the server is rebuilt — Rebuild on this version, on its page.`
      : `${count} change${count === 1 ? "" : "s"} saved.`,
    rebuildRequired,
  };
}

/* Deleting a server, and what is left of it afterwards.

   The world and the archives on its node go with it; that was always
   so. What is in the bucket does not, and until the release work the
   panel pretended otherwise: the backup rows cascaded away with the
   server, the objects stayed where they were with nothing left that
   named them, and the message said every snapshot was gone.

   Now an off-site backup outlives its server, row and all. The row
   loses its server and keeps what it was a backup of, and from the
   Backups page it can still be checked, deleted, or restored into
   another server of the same game. `finalBackup` takes one more of those
   first — and if it cannot be taken, nothing is deleted, because a last
   backup that quietly did not happen is worse than none offered. */
export async function deleteServerOp(
  user: User,
  slug: string,
  confirmation: string,
  options: { finalBackup?: boolean } = {},
): Promise<OpResult> {
  const auth = await authorize(user, slug);
  if (!auth.ok) return { ok: false, title: "Cannot delete", body: auth.error };
  const { server } = auth;

  if (confirmation.trim() !== server.name) {
    return {
      ok: false,
      title: "Name does not match",
      body: `Type "${server.name}" exactly to confirm.`,
    };
  }

  let finalBackupName: string | null = null;
  if (options.finalBackup) {
    const taken = await createBackupOp(user, slug, { trigger: "PRE_DELETE", store: "S3", prefix: "final" });
    if (!taken.ok) {
      return {
        ok: false,
        title: "Not deleted",
        body: `The last backup could not be taken — ${taken.body} ${server.name} is untouched. Delete it without one, or fix that first.`,
      };
    }
    finalBackupName = (await db.backup.findUnique({ where: { id: taken.backupId ?? "" }, select: { name: true } }))?.name ?? null;
  }

  /* The node comes first. Dropping the row while the container is still
     running would leave something the panel can no longer see, holding
     a port and a directory nobody can reach — so a node that refuses is
     a delete that does not happen, and says why. */
  const runtime = runtimeFor(auth.node);
  let removed = { workload: false, data: false };

  if (runtime) {
    try {
      /* The ref carries both ids: the runtime handle when there is one,
         and the server id, which still reaches a directory left behind
         by a create that never got as far as a workload. */
      removed = await runtime.destroy(refFor(server), true);
    } catch (error) {
      const message = asPlatformError(error).message;
      return {
        ok: false,
        title: "Cannot delete",
        body: `${message}. ${server.name} is untouched — deleting it here would strand it on ${auth.node.name}.`,
      };
    }
  }

  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "server.deleted",
      target: server.name,
      tone: "DANGER",
      userId: user.id,
      changes: {
        Node: { from: auth.node.name, to: "—" },
        Address: { from: `${server.host}:${server.port}`, to: "—" },
      },
    },
  });
  /* The rows of what went with the disk go; the rows of what is in the
     bucket stay, told what they were a backup of before the server that
     could have said is gone. One transaction, so a failure leaves the
     server and every row as they were. */
  const [, kept] = await db.$transaction([
    // Spelled out rather than negated: a null store is not "not S3" to SQL.
    db.backup.deleteMany({
      where: { serverId: server.id, OR: [{ store: null }, { store: "LOCAL" }, { artifact: null }] },
    }),
    db.backup.updateMany({
      where: { serverId: server.id, store: "S3", artifact: { not: null } },
      data: {
        originServerId: server.id,
        originServerName: server.name,
        originGameId: server.gameId,
        originOwnerId: server.ownerId,
      },
    }),
    db.server.delete({ where: { id: server.id } }),
  ]);

  const offsite =
    kept.count === 0
      ? ""
      : ` ${kept.count === 1 ? "One off-site backup stays" : `${kept.count} off-site backups stay`} in the bucket${
          finalBackupName ? (kept.count === 1 ? ` (${finalBackupName})` : `, ${finalBackupName} among them`) : ""
        } — on the Backups page, where ${kept.count === 1 ? "it" : "each"} can be restored into another server of the same game, or deleted.`;

  return {
    ok: true,
    tone: "warning",
    title: `${server.name} deleted`,
    // It used to say "the running server" of one that had been stopped for a week.
    body: runtime
      ? `${auth.node.name} removed ${removed.workload ? "the server, " : ""}its world data and the backups on its disk.${offsite}`
      : `${auth.node.name} has no agent, so only the panel's record was removed.${offsite}`,
  };
}

/* ── Members ──────────────────────────────────────────────────── */

const ROLE_RANK: Record<Role, number> = { OWNER: 3, ADMIN: 2, MODERATOR: 1, MEMBER: 0 };

async function logAccountEvent(
  actor: string,
  action: string,
  target: string,
  tone: EventTone,
  userId: string,
  changes?: Record<string, { from: string | number | boolean; to: string | number | boolean }>,
) {
  await db.activityEvent.create({ data: { actor, action, target, tone, userId, changes } });
}

export async function changeMemberRoleOp(
  actor: User,
  memberId: string,
  role: Role,
): Promise<OpResult> {
  if (actor.role !== "OWNER" && actor.role !== "ADMIN") {
    return { ok: false, title: "Not permitted", body: "Only owners and admins can change roles." };
  }

  const member = await db.user.findUnique({ where: { id: memberId } });
  if (!member) return { ok: false, title: "Cannot change", body: "That account no longer exists." };

  if (isSystemAccount(member)) {
    return {
      ok: false,
      title: "That is a system account",
      body: `${member.name} is how the panel attributes its own work. Its role is fixed.`,
    };
  }

  // Changing your own role is how people accidentally lock themselves
  // out, or quietly promote themselves.
  if (member.id === actor.id) {
    return {
      ok: false,
      title: "Cannot change your own role",
      body: "Ask another owner to change it for you.",
    };
  }

  if (member.role === role) {
    return { ok: false, title: "No change", body: `${member.name} is already ${role.toLowerCase()}.` };
  }

  // Admins must not be able to mint owners, or strip an existing one.
  if (actor.role === "ADMIN" && (role === "OWNER" || member.role === "OWNER")) {
    return {
      ok: false,
      title: "Not permitted",
      body: "Only an owner can grant or remove the owner role.",
    };
  }

  if (member.role === "OWNER" && ROLE_RANK[role] < ROLE_RANK.OWNER) {
    const owners = await db.user.count({ where: { role: "OWNER" } });
    if (owners <= 1) {
      return {
        ok: false,
        title: "Last owner",
        body: "Promote someone else to owner before changing this account.",
      };
    }
  }

  await db.user.update({ where: { id: member.id }, data: { role } });
  await logAccountEvent(
    actor.name,
    "member.role.changed",
    `${member.name} → ${role.toLowerCase()}`,
    ROLE_RANK[role] > ROLE_RANK[member.role] ? "INFO" : "WARNING",
    actor.id,
    { Role: { from: member.role, to: role } },
  );

  return {
    ok: true,
    tone: "success",
    title: "Role updated",
    body: `${member.name} is now ${role.toLowerCase()}.`,
  };
}

export async function removeMemberOp(actor: User, memberId: string): Promise<OpResult> {
  if (actor.role !== "OWNER" && actor.role !== "ADMIN") {
    return { ok: false, title: "Not permitted", body: "Only owners and admins can remove members." };
  }

  const member = await db.user.findUnique({
    where: { id: memberId },
    include: { servers: { select: { name: true } } },
  });
  if (!member) return { ok: false, title: "Cannot remove", body: "That account no longer exists." };

  if (isSystemAccount(member)) {
    return {
      ok: false,
      title: "That is a system account",
      body: `${member.name} is how the panel attributes its own work, and removing it would take its history with it.`,
    };
  }

  if (member.id === actor.id) {
    return { ok: false, title: "Cannot remove yourself", body: "Ask another owner to do it." };
  }

  if (actor.role === "ADMIN" && member.role === "OWNER") {
    return { ok: false, title: "Not permitted", body: "Only an owner can remove another owner." };
  }

  if (member.role === "OWNER") {
    const owners = await db.user.count({ where: { role: "OWNER" } });
    if (owners <= 1) {
      return { ok: false, title: "Last owner", body: "A workspace must keep at least one owner." };
    }
  }

  // Servers are owned, not shared — deleting the account would cascade
  // them away, so transfer has to happen first.
  if (member.servers.length > 0) {
    const names = member.servers.map((s) => s.name).join(", ");
    return {
      ok: false,
      title: "Servers still owned",
      body: `Transfer ${names} to someone else before removing ${member.name}.`,
    };
  }

  await logAccountEvent(actor.name, "member.removed", member.email, "DANGER", actor.id);
  await db.user.delete({ where: { id: member.id } });

  return {
    ok: true,
    tone: "warning",
    title: "Member removed",
    body: `${member.name} no longer has access. Their sessions were revoked.`,
  };
}

/* ── Nodes ────────────────────────────────────────────────────── */

export async function setNodeDrainOp(actor: User, name: string, drain: boolean): Promise<OpResult> {
  if (actor.role !== "OWNER" && actor.role !== "ADMIN") {
    return { ok: false, title: "Not permitted", body: "Only owners and admins can drain nodes." };
  }

  const node = await db.node.findUnique({
    where: { name },
    include: { servers: { select: { id: true, state: true } } },
  });
  if (!node) return { ok: false, title: "Cannot change", body: "That node no longer exists." };

  if (drain && node.state === "DRAINING") {
    return { ok: false, title: "Already draining", body: `${node.name} is already draining.` };
  }
  if (!drain && node.state !== "DRAINING") {
    return { ok: false, title: "Not draining", body: `${node.name} is not in a draining state.` };
  }

  await db.node.update({
    where: { id: node.id },
    data: { state: drain ? "DRAINING" : "HEALTHY" },
  });

  await logAccountEvent(
    actor.name,
    drain ? "node.drained" : "node.resumed",
    node.name,
    drain ? "WARNING" : "SUCCESS",
    actor.id,
    { State: { from: node.state, to: drain ? "DRAINING" : "HEALTHY" } },
  );

  const live = node.servers.filter((s) => s.state === "RUNNING" || s.state === "STARTING").length;
  return {
    ok: true,
    tone: drain ? "warning" : "success",
    title: drain ? `${node.name} is draining` : `${node.name} is back in rotation`,
    /* Not "need moving": there is no moving servers between nodes yet,
       and a message that suggests an action nobody can take is how
       somebody goes looking for a button that does not exist. */
    body: drain
      ? node.servers.length === 0
        ? "No new servers will be placed here. It has none, so it can be removed from its page."
        : `No new servers will be placed here. The ${node.servers.length} on it keep running${
            live < node.servers.length ? ` (${live} up)` : ""
          }; retiring it means deleting them first.`
      : "It will accept new server placements again.",
  };
}

/* ── API keys ─────────────────────────────────────────────────── */

/* `ready` says whether the HTTP API has a route this scope reaches.

   The panel can do more than /api/v1 exposes — consoles, files and
   backups are server actions, not endpoints — and a key that granted
   files:write bought nothing but a false sense of what the API does.
   Those scopes are shown, marked, and refused until the routes exist.
   See docs/api.md for what is routed today. */
/* Every scope has routes behind it now; `ready` stays as the switch it
   was, so a scope added before its routes exist is refused rather than
   issued as a promise. */
export const API_SCOPES = [
  { id: "servers:read", label: "List servers, backups and tasks, read their state", ready: true },
  { id: "servers:write", label: "Start, stop, restart, update, settings and scheduled tasks", ready: true },
  { id: "servers:manage", label: "Create, delete, roll back and move servers", ready: true },
  { id: "metrics:read", label: "Read CPU, memory and player counts", ready: true },
  { id: "console:write", label: "Send commands to a running console", ready: true },
  { id: "files:read", label: "Read files and list directories", ready: true },
  { id: "files:write", label: "Write, create and delete files", ready: true },
  { id: "backups:write", label: "Create, restore, lock and delete snapshots", ready: true },
  { id: "nodes:manage", label: "Approve, reject, drain and remove nodes", ready: true },
  { id: "audit:read", label: "Read the audit log", ready: true },
] as const;

const SCOPE_IDS: Set<string> = new Set(API_SCOPES.filter((s) => s.ready).map((s) => s.id));

/* The secret is shown once and never stored in the clear — only a
   bcrypt hash, plus a masked prefix so the UI can identify the key. */
function mintSecret() {
  const secret = `gbk_live_${randomBytes(16).toString("hex")}`;
  const body = secret.slice("gbk_live_".length);
  return { secret, prefix: `gbk_live_${body.slice(0, 4)}…${body.slice(-4)}` };
}

export async function createApiKeyOp(
  user: User,
  name: string,
  scopes: string[],
): Promise<OpResult & { secret?: string }> {
  const trimmed = name.trim();
  if (trimmed.length < 2) return { ok: false, title: "Name required", body: "Give the key a name you will recognise later." };
  if (trimmed.length > 60) return { ok: false, title: "Name too long", body: "Keep it under 60 characters." };

  const valid = scopes.filter((s) => SCOPE_IDS.has(s));
  if (valid.length === 0) {
    return { ok: false, title: "No scopes selected", body: "A key with no scopes cannot do anything." };
  }
  if (valid.length !== scopes.length) {
    const named = API_SCOPES.filter((s) => !s.ready && scopes.includes(s.id)).map((s) => s.id);
    return named.length > 0
      ? {
          ok: false,
          title: "No endpoint for that scope yet",
          body: `${named.join(", ")} ${named.length === 1 ? "has" : "have"} no route in the HTTP API, so a key cannot use ${named.length === 1 ? "it" : "them"} yet.`,
        }
      : { ok: false, title: "Unknown scope", body: "One of those scopes is not recognised." };
  }

  const existing = await db.apiKey.count({ where: { userId: user.id, name: trimmed, revokedAt: null } });
  if (existing > 0) {
    return { ok: false, title: "Name already used", body: `You already have an active key called ${trimmed}.` };
  }

  const { secret, prefix } = mintSecret();
  await db.apiKey.create({
    data: { userId: user.id, name: trimmed, prefix, hash: await bcrypt.hash(secret, 10), scopes: valid },
  });

  await logAccountEvent(user.name, "api_key.created", trimmed, "INFO", user.id, {
    Scopes: { from: "—", to: valid.join(", ") },
  });

  return {
    ok: true,
    tone: "success",
    title: "Key created",
    body: "Copy the secret now — it is not shown again.",
    secret,
  };
}

export async function revokeApiKeyOp(user: User, keyId: string): Promise<OpResult> {
  const key = await db.apiKey.findUnique({ where: { id: keyId }, include: { user: true } });
  if (!key) return { ok: false, title: "Cannot revoke", body: "That key no longer exists." };

  // Your own keys are yours; anyone else's needs owner or admin.
  const privileged = user.role === "OWNER" || user.role === "ADMIN";
  if (key.userId !== user.id && !privileged) {
    return { ok: false, title: "Not permitted", body: `${key.name} belongs to ${key.user.name}.` };
  }

  if (key.revokedAt) {
    return { ok: false, title: "Already revoked", body: `${key.name} was revoked already.` };
  }

  await db.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
  await logAccountEvent(user.name, "api_key.revoked", key.name, "DANGER", user.id, {
    Scopes: { from: key.scopes.join(", "), to: "revoked" },
  });

  return {
    ok: true,
    tone: "warning",
    title: "Key revoked",
    body: `${key.name} stops working immediately. Anything using it will start failing.`,
  };
}

export async function deleteApiKeyOp(user: User, keyId: string): Promise<OpResult> {
  const key = await db.apiKey.findUnique({ where: { id: keyId }, include: { user: true } });
  if (!key) return { ok: false, title: "Cannot delete", body: "That key no longer exists." };

  const privileged = user.role === "OWNER" || user.role === "ADMIN";
  if (key.userId !== user.id && !privileged) {
    return { ok: false, title: "Not permitted", body: `${key.name} belongs to ${key.user.name}.` };
  }

  // Revoking is reversible-ish (the record stays); deleting loses the
  // audit trail of what the key could reach, so revoke first.
  if (!key.revokedAt) {
    return {
      ok: false,
      title: "Revoke it first",
      body: "Revoke the key so anything still using it fails loudly, then remove the record.",
    };
  }

  await db.apiKey.delete({ where: { id: keyId } });
  await logAccountEvent(user.name, "api_key.deleted", key.name, "MUTED", user.id);

  return { ok: true, tone: "success", title: "Key removed", body: `${key.name} is gone from the list.` };
}

/* ── Console ──────────────────────────────────────────────────── */

export async function sendConsoleCommandOp(
  user: User,
  slug: string,
  command: string,
): Promise<OpResult> {
  const trimmed = command.trim();
  if (!trimmed) return { ok: false, title: "Nothing to send", body: "Type a command first." };
  if (trimmed.includes("\n")) {
    return { ok: false, title: "One line only", body: "Send commands one at a time." };
  }

  const auth = await authorize(user, slug);
  if (!auth.ok) return { ok: false, title: "Cannot send", body: auth.error };
  const { server, node } = auth;

  const runtime = runtimeFor(node);
  if (!runtime || !server.runtimeId) {
    return {
      ok: false,
      title: "No agent on this node",
      body: `${node.name} has no agent attached, so nothing can reach the server's console.`,
    };
  }

  if (server.state !== "RUNNING") {
    return {
      ok: false,
      title: "Server is not running",
      body: `${server.name} is ${server.state.toLowerCase()} — there is no console to talk to.`,
    };
  }

  try {
    await runtime.sendCommand(refFor(server), trimmed);
  } catch (error) {
    return { ok: false, title: "Command failed", body: asPlatformError(error).message };
  }

  // Console commands are privileged actions; the audit log gets them too.
  await logEvent(user.name, "console.command", trimmed, "ACCENT", user.id, server.id);

  return { ok: true, tone: "success", title: "Sent", body: trimmed };
}
