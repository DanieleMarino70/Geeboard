"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  checkStorageOp,
  configureStorageOp,
  removeStorageOp,
  setScheduledOffsiteOp,
  type StorageInput,
} from "@/lib/storage-ops";
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

/* Off-site storage. The keys arrive here once, go to the operation, and
   are never part of anything rendered afterwards. */
export async function configureStorage(input: StorageInput): Promise<OpResult> {
  const r = await configureStorageOp(await requireUser(), input);
  if (r.ok) {
    revalidatePath("/backups");
    revalidatePath("/audit");
  }
  return r;
}

export async function checkStorage(): Promise<OpResult> {
  const r = await checkStorageOp(await requireUser());
  revalidatePath("/backups");
  return r;
}

export async function removeStorage(): Promise<OpResult> {
  const r = await removeStorageOp(await requireUser());
  if (r.ok) {
    revalidatePath("/backups");
    revalidatePath("/audit");
  }
  return r;
}

export async function setScheduledOffsite(on: boolean): Promise<OpResult> {
  const r = await setScheduledOffsiteOp(await requireUser(), on);
  if (r.ok) revalidatePath("/backups");
  return r;
}
