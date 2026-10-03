"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import type { OpResult } from "@/lib/server-ops";
import { cloneWorldOp, deleteTemplateOp, saveTemplateOp } from "@/lib/template-ops";

/* Thin, like the other action files: resolve the user, call the
   operation, revalidate what shows the result. */

export async function saveTemplate(slug: string, name: string): Promise<OpResult> {
  const result = await saveTemplateOp(await requireUser(), String(slug ?? ""), String(name ?? ""));
  if (result.ok) {
    revalidatePath("/templates");
    revalidatePath("/audit");
  }
  return result;
}

export async function deleteTemplate(id: string): Promise<OpResult> {
  const result = await deleteTemplateOp(await requireUser(), String(id ?? ""));
  if (result.ok) {
    revalidatePath("/templates");
    revalidatePath("/audit");
  }
  return result;
}

/* The wizard's second step of a clone: the new server exists, and now it is given the
   world. Revalidates what shows a server either way, since a failure changes nothing
   but the log. */
export async function cloneWorld(sourceSlug: string, targetSlug: string): Promise<OpResult> {
  const result = await cloneWorldOp(await requireUser(), String(sourceSlug ?? ""), String(targetSlug ?? ""));
  revalidatePath("/servers");
  revalidatePath(`/servers/${targetSlug}`);
  revalidatePath("/backups");
  revalidatePath("/audit");
  return result;
}
