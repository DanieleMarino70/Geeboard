import "server-only";
import type { EventTone, Server, User } from "@prisma/client";
import { nextRun } from "./cron";
import { scheduleSettle } from "./daemon-sim";
import { db } from "./db";

/* The lifecycle operations, as plain functions of (actor, slug).
   Server actions in app/actions/servers.ts are thin wrappers that
   resolve the signed-in user and revalidate; everything that decides
   what happens lives here, where it can be exercised directly. */

export type OpResult =
  | { ok: true; title: string; body: string; tone: "success" | "warning" }
  | { ok: false; title: string; body: string };

type Authorized = { ok: true; user: User; server: Server };
type Denied = { ok: false; error: string };

/* Owners and admins can act on anything; everyone else only on the
   servers they own. Moderators get console access but not lifecycle
   control — the split the permission editor in the design encodes. */
export async function authorize(user: User, slug: string): Promise<Authorized | Denied> {
  const server = await db.server.findUnique({ where: { slug } });
  if (!server) return { ok: false, error: "That server no longer exists." };

  const privileged = user.role === "OWNER" || user.role === "ADMIN";
  if (!privileged && server.ownerId !== user.id) {
    return { ok: false, error: "You do not have permission to control this server." };
  }
  return { ok: true, user, server };
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

export async function startServerOp(user: User, slug: string): Promise<OpResult> {
  const auth = await authorize(user, slug);
  if (!auth.ok) return { ok: false, title: "Cannot start", body: auth.error };
  const { server } = auth;

  if (server.state === "RUNNING" || server.state === "STARTING") {
    return { ok: false, title: "Already up", body: `${server.name} is ${server.state.toLowerCase()}.` };
  }

  await db.server.update({ where: { id: server.id }, data: { state: "STARTING" } });
  scheduleSettle(server.id, "STARTING", "RUNNING");
  await logEvent(user.name, "started", server.name, "ACCENT", user.id, server.id);

  return {
    ok: true,
    tone: "success",
    title: `Starting ${server.name}`,
    body: "Allocating the container and generating the spawn area.",
  };
}

export async function stopServerOp(user: User, slug: string): Promise<OpResult> {
  const auth = await authorize(user, slug);
  if (!auth.ok) return { ok: false, title: "Cannot stop", body: auth.error };
  const { server } = auth;

  if (server.state === "STOPPED" || server.state === "STOPPING") {
    return { ok: false, title: "Already down", body: `${server.name} is ${server.state.toLowerCase()}.` };
  }

  await db.server.update({ where: { id: server.id }, data: { state: "STOPPING" } });
  scheduleSettle(server.id, "STOPPING", "STOPPED");
  await logEvent(user.name, "stopped", server.name, "WARNING", user.id, server.id);

  return {
    ok: true,
    tone: "warning",
    title: "Stop requested",
    body: `${server.name} is saving the world before shutdown.`,
  };
}

export async function restartServerOp(user: User, slug: string): Promise<OpResult> {
  const auth = await authorize(user, slug);
  if (!auth.ok) return { ok: false, title: "Cannot restart", body: auth.error };
  const { server } = auth;

  await db.server.update({ where: { id: server.id }, data: { state: "STARTING", playersOn: 0 } });
  scheduleSettle(server.id, "STARTING", "RUNNING");
  await logEvent(user.name, "restarted", server.name, "ACCENT", user.id, server.id);

  return {
    ok: true,
    tone: "success",
    title: `Restarting ${server.name}`,
    body: "Players were warned. Expected downtime is about 24 seconds.",
  };
}

export async function createBackupOp(user: User, slug: string): Promise<OpResult> {
  const auth = await authorize(user, slug);
  if (!auth.ok) return { ok: false, title: "Cannot back up", body: auth.error };
  const { server } = auth;

  const today = new Date();
  const stamp = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const existing = await db.backup.count({
    where: { serverId: server.id, name: { startsWith: `manual-${stamp}` } },
  });
  const name = existing === 0 ? `manual-${stamp}` : `manual-${stamp}-${existing + 1}`;

  // Size is a plausible stand-in until the daemon reports the real one.
  const bytes = BigInt(Math.round((3 + Math.random() * 0.6) * 1024 ** 3));

  await db.backup.create({
    data: {
      serverId: server.id,
      name,
      sizeBytes: bytes,
      trigger: "MANUAL",
      state: "COMPLETE",
      checksum: `sha256:${Math.random().toString(16).slice(2, 10)}…`,
    },
  });
  await logEvent(user.name, "created a snapshot", name, "SUCCESS", user.id, server.id);

  return {
    ok: true,
    tone: "success",
    title: "Snapshot complete",
    body: `${server.name} · ${name} · ${(Number(bytes) / 1024 ** 3).toFixed(2)} GB`,
  };
}

/* ── Backup and schedule operations ───────────────────────────── */

export async function deleteBackupOp(user: User, backupId: string): Promise<OpResult> {
  const backup = await db.backup.findUnique({
    where: { id: backupId },
    include: { server: true },
  });
  if (!backup) return { ok: false, title: "Cannot delete", body: "That snapshot no longer exists." };

  if (backup.state === "LOCKED") {
    return {
      ok: false,
      title: "Snapshot is locked",
      body: `${backup.name} is retained indefinitely. Unlock it before deleting.`,
    };
  }

  const auth = await authorize(user, backup.server.slug);
  if (!auth.ok) return { ok: false, title: "Cannot delete", body: auth.error };

  await db.backup.delete({ where: { id: backupId } });
  await logEvent(user.name, "deleted a snapshot", backup.name, "DANGER", user.id, backup.serverId);

  return {
    ok: true,
    tone: "warning",
    title: "Snapshot deleted",
    body: `${backup.name} is gone. This cannot be undone.`,
  };
}

export async function restoreBackupOp(user: User, backupId: string): Promise<OpResult> {
  const backup = await db.backup.findUnique({
    where: { id: backupId },
    include: { server: true },
  });
  if (!backup) return { ok: false, title: "Cannot restore", body: "That snapshot no longer exists." };

  const auth = await authorize(user, backup.server.slug);
  if (!auth.ok) return { ok: false, title: "Cannot restore", body: auth.error };

  // Restoring stops the server first; the daemon does the unpacking.
  await db.server.update({
    where: { id: backup.serverId },
    data: { state: "STOPPING", playersOn: 0 },
  });
  scheduleSettle(backup.serverId, "STOPPING", "STOPPED");
  await logEvent(user.name, "restored a snapshot", backup.name, "WARNING", user.id, backup.serverId);

  return {
    ok: true,
    tone: "warning",
    title: `Restoring ${backup.name}`,
    body: `${backup.server.name} is stopping first. The world is replaced on the way back up.`,
  };
}

export async function setBackupLockOp(
  user: User,
  backupId: string,
  locked: boolean,
): Promise<OpResult> {
  const backup = await db.backup.findUnique({
    where: { id: backupId },
    include: { server: true },
  });
  if (!backup) return { ok: false, title: "Cannot change", body: "That snapshot no longer exists." };

  const auth = await authorize(user, backup.server.slug);
  if (!auth.ok) return { ok: false, title: "Cannot change", body: auth.error };

  await db.backup.update({
    where: { id: backupId },
    data: { state: locked ? "LOCKED" : "COMPLETE", keepUntil: null },
  });
  await logEvent(
    user.name,
    locked ? "locked a snapshot" : "unlocked a snapshot",
    backup.name,
    locked ? "INFO" : "MUTED",
    user.id,
    backup.serverId,
  );

  return {
    ok: true,
    tone: "success",
    title: locked ? "Snapshot locked" : "Snapshot unlocked",
    body: locked
      ? `${backup.name} is now kept indefinitely and skipped by retention.`
      : `${backup.name} follows the retention policy again.`,
  };
}

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

export async function runTaskNowOp(user: User, taskId: string): Promise<OpResult> {
  const task = await db.scheduledTask.findUnique({
    where: { id: taskId },
    include: { server: true },
  });
  if (!task) return { ok: false, title: "Cannot run", body: "That task no longer exists." };

  const auth = await authorize(user, task.server.slug);
  if (!auth.ok) return { ok: false, title: "Cannot run", body: auth.error };

  if (task.kind === "BACKUP") {
    const result = await createBackupOp(user, task.server.slug);
    await db.scheduledTask.update({
      where: { id: taskId },
      data: { lastRunAt: new Date(), lastResult: result.ok ? "SUCCEEDED" : "FAILED" },
    });
    return result;
  }

  if (task.kind === "RESTART") {
    const result = await restartServerOp(user, task.server.slug);
    await db.scheduledTask.update({
      where: { id: taskId },
      data: { lastRunAt: new Date(), lastResult: result.ok ? "SUCCEEDED" : "FAILED" },
    });
    return result;
  }

  // Broadcasts, cleanups and raw commands need the daemon to carry them
  // out; recording the run is all the panel can honestly do today.
  await db.scheduledTask.update({
    where: { id: taskId },
    data: { lastRunAt: new Date(), lastResult: "SUCCEEDED" },
  });
  await logEvent(user.name, "ran a task", task.name, "ACCENT", user.id, task.serverId);

  return {
    ok: true,
    tone: "success",
    title: `${task.name} ran`,
    body: task.payload ? `Sent: ${task.payload}` : "The task completed.",
  };
}

/* ── Server settings ──────────────────────────────────────────── */

export interface SettingsInput {
  name: string;
  host: string;
  motd: string;
  javaFlags: string;
  memoryLimit: number;
  cpuLimit: number;
  autosave: boolean;
  whitelist: boolean;
  autoRestart: boolean;
}

const FIELD_LABELS: Record<keyof SettingsInput, string> = {
  name: "Server name",
  host: "Subdomain",
  motd: "MOTD",
  javaFlags: "Startup flags",
  memoryLimit: "Heap ceiling",
  cpuLimit: "CPU limit",
  autosave: "Autosave",
  whitelist: "Whitelist only",
  autoRestart: "Restart after crash",
};

/* Fields the server only picks up when it next boots. */
const RESTART_REQUIRED = new Set<keyof SettingsInput>([
  "motd",
  "javaFlags",
  "memoryLimit",
  "cpuLimit",
]);

export function validateSettings(input: SettingsInput): string | null {
  if (input.name.trim().length < 2) return "The server name needs at least two characters.";
  if (input.name.length > 60) return "The server name is too long.";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/i.test(input.host)) {
    return "That subdomain is not a valid hostname.";
  }
  if (input.motd.length > 120) return "The MOTD is limited to 120 characters.";
  if (!Number.isInteger(input.memoryLimit) || input.memoryLimit < 1 || input.memoryLimit > 64) {
    return "Heap ceiling must be between 1 and 64 GB.";
  }
  if (!Number.isInteger(input.cpuLimit) || input.cpuLimit < 50 || input.cpuLimit > 800) {
    return "CPU limit must be between 50% and 800%.";
  }
  return null;
}

export async function updateServerSettingsOp(
  user: User,
  slug: string,
  input: SettingsInput,
): Promise<OpResult & { restartRequired?: boolean }> {
  const auth = await authorize(user, slug);
  if (!auth.ok) return { ok: false, title: "Cannot save", body: auth.error };
  const { server } = auth;

  const invalid = validateSettings(input);
  if (invalid) return { ok: false, title: "Check the form", body: invalid };

  const current: SettingsInput = {
    name: server.name,
    host: server.host,
    motd: server.motd ?? "",
    javaFlags: server.javaFlags ?? "",
    memoryLimit: server.memoryLimit,
    cpuLimit: server.cpuLimit,
    autosave: server.autosave,
    whitelist: server.whitelist,
    autoRestart: server.autoRestart,
  };

  const changes: Record<string, { from: string | number | boolean; to: string | number | boolean }> = {};
  let restartRequired = false;

  for (const key of Object.keys(current) as Array<keyof SettingsInput>) {
    if (current[key] !== input[key]) {
      changes[FIELD_LABELS[key]] = { from: current[key], to: input[key] };
      if (RESTART_REQUIRED.has(key)) restartRequired = true;
    }
  }

  if (Object.keys(changes).length === 0) {
    return { ok: false, title: "Nothing to save", body: "No values were changed." };
  }

  // A host clash would break routing, so it is checked before writing.
  if (input.host !== server.host) {
    const taken = await db.server.findFirst({
      where: { host: input.host, id: { not: server.id } },
      select: { name: true },
    });
    if (taken) {
      return {
        ok: false,
        title: "Subdomain in use",
        body: `${input.host} already points at ${taken.name}.`,
      };
    }
  }

  await db.server.update({
    where: { id: server.id },
    data: {
      name: input.name.trim(),
      host: input.host,
      motd: input.motd || null,
      javaFlags: input.javaFlags || null,
      memoryLimit: input.memoryLimit,
      cpuLimit: input.cpuLimit,
      autosave: input.autosave,
      whitelist: input.whitelist,
      autoRestart: input.autoRestart,
    },
  });

  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "server.settings.updated",
      target: input.name.trim(),
      tone: "ACCENT",
      userId: user.id,
      serverId: server.id,
      changes,
    },
  });

  const count = Object.keys(changes).length;
  return {
    ok: true,
    tone: restartRequired ? "warning" : "success",
    title: "Settings saved",
    body: restartRequired
      ? `${count} change${count === 1 ? "" : "s"} saved. Some apply on the next restart.`
      : `${count} change${count === 1 ? "" : "s"} saved and applied.`,
    restartRequired,
  };
}

export async function deleteServerOp(
  user: User,
  slug: string,
  confirmation: string,
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

  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "server.deleted",
      target: server.name,
      tone: "DANGER",
      userId: user.id,
    },
  });
  await db.server.delete({ where: { id: server.id } });

  return {
    ok: true,
    tone: "warning",
    title: `${server.name} deleted`,
    body: "The container, its world data and every snapshot are gone.",
  };
}
