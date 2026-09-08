"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  createBackupOp,
  restartServerOp,
  startServerOp,
  stopServerOp,
  type OpResult,
} from "@/lib/server-ops";

export type ActionResult = OpResult;

function refresh(slug: string) {
  revalidatePath("/");
  revalidatePath("/servers");
  revalidatePath(`/servers/${slug}`);
  revalidatePath("/console");
}

export async function startServer(slug: string): Promise<ActionResult> {
  const result = await startServerOp(await requireUser(), slug);
  if (result.ok) refresh(slug);
  return result;
}

export async function stopServer(slug: string): Promise<ActionResult> {
  const result = await stopServerOp(await requireUser(), slug);
  if (result.ok) refresh(slug);
  return result;
}

export async function restartServer(slug: string): Promise<ActionResult> {
  const result = await restartServerOp(await requireUser(), slug);
  if (result.ok) refresh(slug);
  return result;
}

export async function createBackup(slug: string): Promise<ActionResult> {
  const result = await createBackupOp(await requireUser(), slug);
  if (result.ok) refresh(slug);
  return result;
}
