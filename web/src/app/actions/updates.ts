"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { rebuildServerOp, rollbackServerOp, updateServerOp } from "@/lib/update-ops";
import type { OpResult } from "@/lib/server-ops";

/* Thin, like the other action files: resolve the user, call the
   operation, revalidate what changed. */

function refresh(slug: string) {
  revalidatePath(`/servers/${slug}`);
  revalidatePath("/servers");
  revalidatePath("/backups");
  revalidatePath("/activity");
}

export async function updateServer(slug: string, versionId: string): Promise<OpResult> {
  const result = await updateServerOp(await requireUser(), slug, versionId);
  if (result.ok) refresh(slug);
  return result;
}

export async function rebuildServer(slug: string): Promise<OpResult> {
  const result = await rebuildServerOp(await requireUser(), slug);
  // A failed rebuild changes the server's state too, so refresh either way.
  refresh(slug);
  return result;
}

export async function rollbackServer(slug: string): Promise<OpResult> {
  const result = await rollbackServerOp(await requireUser(), slug);
  if (result.ok) refresh(slug);
  return result;
}
