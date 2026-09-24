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

/* Each takes the key the page made up to watch the call while it runs —
   the download above all, which can be minutes — see
   components/install-progress.tsx. */

export async function updateServer(slug: string, versionId: string, progressKey?: string): Promise<OpResult> {
  const result = await updateServerOp(await requireUser(), slug, versionId, { progressKey });
  if (result.ok) refresh(slug);
  return result;
}

export async function rebuildServer(slug: string, progressKey?: string): Promise<OpResult> {
  const result = await rebuildServerOp(await requireUser(), slug, { progressKey });
  // A failed rebuild changes the server's state too, so refresh either way.
  refresh(slug);
  return result;
}

export async function rollbackServer(slug: string, progressKey?: string): Promise<OpResult> {
  const result = await rollbackServerOp(await requireUser(), slug, { progressKey });
  if (result.ok) refresh(slug);
  return result;
}
