"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import type { OpResult } from "@/lib/server-ops";
import { createTaskOp, deleteTaskOp, updateTaskOp, type TaskResult } from "@/lib/task-ops";
import type { TaskInput } from "@/lib/task-rules";

function refresh() {
  revalidatePath("/scheduler");
  revalidatePath("/backups");
}

export async function createTask(serverSlug: string, input: TaskInput): Promise<TaskResult> {
  const result = await createTaskOp(await requireUser(), serverSlug, input);
  if (result.ok) refresh();
  return result;
}

export async function updateTask(taskId: string, input: TaskInput): Promise<TaskResult> {
  const result = await updateTaskOp(await requireUser(), taskId, input);
  if (result.ok) refresh();
  return result;
}

export async function deleteTask(taskId: string): Promise<OpResult> {
  const result = await deleteTaskOp(await requireUser(), taskId);
  if (result.ok) refresh();
  return result;
}
