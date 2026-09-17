import "server-only";
import type { User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import { findGame } from "@/domain/games/registry";
import { nextRun } from "./cron";
import { db } from "./db";
import type { OpResult } from "./server-ops";
import { TASK_KIND_LABEL, normaliseTask, validateTask, type TaskErrors, type TaskInput } from "./task-rules";

/* Creating, changing and deleting scheduled tasks. Running them is the
   scheduler's (scheduler.ts, server-ops.ts runTask); this is only what a
   task is. */

export type TaskResult = OpResult & { errors?: TaskErrors };

async function serverFor(user: User, slug: string) {
  const server = await db.server.findUnique({ where: { slug } });
  if (!server) return { error: "That server no longer exists." } as const;
  if (!can(user, "server.schedule.write", server.ownerId)) {
    return { error: "You cannot schedule tasks on this server." } as const;
  }
  return { server } as const;
}

function invalid(errors: TaskErrors): TaskResult {
  return { ok: false, title: "Check the task", body: Object.values(errors)[0] ?? "Something is not right.", errors };
}

export async function createTaskOp(user: User, serverSlug: string, input: TaskInput): Promise<TaskResult> {
  const found = await serverFor(user, serverSlug);
  if ("error" in found) return { ok: false, title: "Cannot create the task", body: found.error! };
  const { server } = found;

  const game = server.gameId ? findGame(server.gameId) : undefined;
  const errors = validateTask(input, game?.console);
  if (Object.keys(errors).length > 0) return invalid(errors);

  const task = normaliseTask(input);
  await db.scheduledTask.create({
    data: { ...task, serverId: server.id, enabled: true, nextRunAt: nextRun(task.cron) },
  });
  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "task.created",
      target: task.name,
      tone: "ACCENT",
      userId: user.id,
      serverId: server.id,
      changes: {
        Kind: { from: "—", to: TASK_KIND_LABEL[task.kind] },
        Schedule: { from: "—", to: task.cron },
        ...(task.payload ? { Payload: { from: "—", to: task.payload } } : {}),
      },
    },
  });

  return { ok: true, tone: "success", title: "Task created", body: `${task.name} runs on ${server.name}.` };
}

export async function updateTaskOp(user: User, taskId: string, input: TaskInput): Promise<TaskResult> {
  const existing = await db.scheduledTask.findUnique({ where: { id: taskId }, include: { server: true } });
  if (!existing) return { ok: false, title: "Cannot save", body: "That task no longer exists." };
  const found = await serverFor(user, existing.server.slug);
  if ("error" in found) return { ok: false, title: "Cannot save", body: found.error! };

  const game = existing.server.gameId ? findGame(existing.server.gameId) : undefined;
  const errors = validateTask(input, game?.console);
  if (Object.keys(errors).length > 0) return invalid(errors);

  const task = normaliseTask(input);
  const changes: Record<string, { from: string; to: string }> = {};
  if (task.name !== existing.name) changes.Name = { from: existing.name, to: task.name };
  if (task.kind !== existing.kind) changes.Kind = { from: TASK_KIND_LABEL[existing.kind], to: TASK_KIND_LABEL[task.kind] };
  if (task.cron !== existing.cron) changes.Schedule = { from: existing.cron, to: task.cron };
  if ((task.payload ?? "") !== (existing.payload ?? "")) {
    changes.Payload = { from: existing.payload ?? "—", to: task.payload ?? "—" };
  }
  if (Object.keys(changes).length === 0) {
    return { ok: false, title: "Nothing to save", body: "No values were changed." };
  }

  await db.scheduledTask.update({
    where: { id: taskId },
    data: { ...task, nextRunAt: existing.enabled ? nextRun(task.cron) : null },
  });
  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "task.updated",
      target: task.name,
      tone: "ACCENT",
      userId: user.id,
      serverId: existing.serverId,
      changes,
    },
  });
  return { ok: true, tone: "success", title: "Task saved", body: `${task.name} is updated.` };
}

export async function deleteTaskOp(user: User, taskId: string): Promise<OpResult> {
  const existing = await db.scheduledTask.findUnique({ where: { id: taskId }, include: { server: true } });
  if (!existing) return { ok: false, title: "Cannot delete", body: "That task no longer exists." };
  const found = await serverFor(user, existing.server.slug);
  if ("error" in found) return { ok: false, title: "Cannot delete", body: found.error! };

  await db.scheduledTask.delete({ where: { id: taskId } });
  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "task.deleted",
      target: existing.name,
      tone: "WARNING",
      userId: user.id,
      serverId: existing.serverId,
      changes: { Schedule: { from: existing.cron, to: "—" } },
    },
  });
  return { ok: true, tone: "success", title: "Task deleted", body: `${existing.name} will not run again.` };
}
