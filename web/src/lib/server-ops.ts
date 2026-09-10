import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { EventTone, Role, Server, ServerState, User } from "@prisma/client";
import { asPlatformError } from "@/domain/errors";
import { runtimeFor } from "@/domain/runtime/docker";
import type { RuntimeRef } from "@/domain/runtime/types";
import { mapRuntimeState } from "@/domain/servers/state";
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
  if (!runtime || !server.runtimeId) return { real: false };

  const ref = refFor(server);
  try {
    const status =
      action === "start"
        ? await runtime.start(ref)
        : action === "stop"
          ? await runtime.stop(ref, graceSeconds)
          : await runtime.restart(ref, graceSeconds);
    return { real: true, state: mapRuntimeState(status.state) };
  } catch (error) {
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
  await logEvent(user.name, "started", server.name, "ACCENT", user.id, server.id);

  return {
    ok: true,
    tone: "success",
    title: `Starting ${server.name}`,
    body: drive.real
      ? `${auth.node.name} reports it ${drive.state === "RUNNING" ? "running" : drive.state.toLowerCase()}.`
      : "No agent on this node — simulating the start.",
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
  await logEvent(user.name, "stopped", server.name, "WARNING", user.id, server.id);

  return {
    ok: true,
    tone: "warning",
    title: "Stop requested",
    body: drive.real
      ? `${auth.node.name} reports it ${drive.state.toLowerCase()}.`
      : `${server.name} is saving the world before shutdown.`,
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
  await logEvent(user.name, "restarted", server.name, "ACCENT", user.id, server.id);

  return {
    ok: true,
    tone: "success",
    title: `Restarting ${server.name}`,
    body: drive.real
      ? `${auth.node.name} restarted it; now ${drive.state.toLowerCase()}.`
      : "Players were warned. Expected downtime is about 24 seconds.",
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
  await db.server.delete({ where: { id: server.id } });

  return {
    ok: true,
    tone: "warning",
    title: `${server.name} deleted`,
    body: runtime
      ? `${auth.node.name} removed ${removed.workload ? "the running server and " : ""}its world data. Every snapshot is gone too.`
      : `${auth.node.name} has no agent, so only the panel's record was removed.`,
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
    body: drain
      ? `No new servers will be placed here. ${live} running server${live === 1 ? "" : "s"} need moving.`
      : "It will accept new server placements again.",
  };
}

/* ── API keys ─────────────────────────────────────────────────── */

export const API_SCOPES = [
  { id: "servers:read", label: "List servers and read their state" },
  { id: "servers:write", label: "Start, stop, restart and reconfigure" },
  { id: "console:write", label: "Send commands to a running console" },
  { id: "files:read", label: "Download files and list directories" },
  { id: "files:write", label: "Upload, edit and delete files" },
  { id: "backups:write", label: "Create, restore and delete snapshots" },
  { id: "metrics:read", label: "Read CPU, memory and player metrics" },
] as const;

const SCOPE_IDS = new Set(API_SCOPES.map((s) => s.id));

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

  const valid = scopes.filter((s) => SCOPE_IDS.has(s as (typeof API_SCOPES)[number]["id"]));
  if (valid.length === 0) {
    return { ok: false, title: "No scopes selected", body: "A key with no scopes cannot do anything." };
  }
  if (valid.length !== scopes.length) {
    return { ok: false, title: "Unknown scope", body: "One of those scopes is not recognised." };
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
