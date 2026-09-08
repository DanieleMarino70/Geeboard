"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  deleteBackupOp,
  restoreBackupOp,
  runTaskNowOp,
  setBackupLockOp,
  toggleTaskOp,
  type OpResult,
} from "@/lib/server-ops";

function refresh() {
  revalidatePath("/");
  revalidatePath("/backups");
  revalidatePath("/scheduler");
  revalidatePath("/servers");
}

export async function deleteBackup(id: string): Promise<OpResult> {
  const r = await deleteBackupOp(await requireUser(), id);
  if (r.ok) refresh();
  return r;
}

export async function restoreBackup(id: string): Promise<OpResult> {
  const r = await restoreBackupOp(await requireUser(), id);
  if (r.ok) refresh();
  return r;
}

export async function setBackupLock(id: string, locked: boolean): Promise<OpResult> {
  const r = await setBackupLockOp(await requireUser(), id, locked);
  if (r.ok) refresh();
  return r;
}

export async function toggleTask(id: string): Promise<OpResult> {
  const r = await toggleTaskOp(await requireUser(), id);
  if (r.ok) refresh();
  return r;
}

export async function runTaskNow(id: string): Promise<OpResult> {
  const r = await runTaskNowOp(await requireUser(), id);
  if (r.ok) refresh();
  return r;
}
