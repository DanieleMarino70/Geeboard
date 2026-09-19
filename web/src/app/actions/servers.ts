"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { moveServerOp } from "@/lib/move-ops";
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

/* A move changes the node, the port and the workload; every page that
   names any of them is refreshed. */
export async function moveServer(slug: string, nodeName: string): Promise<ActionResult> {
  const result = await moveServerOp(await requireUser(), slug, nodeName);
  if (result.ok) {
    refresh(slug);
    revalidatePath("/settings");
    revalidatePath("/backups");
    revalidatePath("/nodes");
    revalidatePath("/audit");
  }
  return result;
}

export async function createBackup(slug: string, store?: "LOCAL" | "S3"): Promise<ActionResult> {
  const result = await createBackupOp(await requireUser(), slug, store ? { store } : {});
  if (result.ok) {
    refresh(slug);
    revalidatePath("/backups");
  }
  return result;
}
