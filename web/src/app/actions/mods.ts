"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  addCollectionOp,
  addModOp,
  applyModsOp,
  refreshInstalledOp,
  removeModOp,
  reorderModsOp,
  searchModsOp,
  setModEnabledOp,
  type SearchResult,
} from "@/lib/mod-ops";
import type { OpResult } from "@/lib/server-ops";
import { checkWorkshopKeyOp, removeWorkshopKeyOp, setWorkshopKeyOp } from "@/lib/steam-ops";

/* Thin, like the other action files: resolve the user, call the
   operation, revalidate the page the mod list is on. */

function refresh(slug: string) {
  revalidatePath("/mods");
  revalidatePath(`/servers/${slug}`);
}

/** Browsing the Workshop, or resolving a link somebody pasted. */
export async function searchMods(slug: string, text: string, page = 1): Promise<SearchResult> {
  return searchModsOp(await requireUser(), slug, text, page);
}

export async function addMod(slug: string, idOrUrl: string): Promise<OpResult> {
  const result = await addModOp(await requireUser(), slug, idOrUrl);
  if (result.ok) refresh(slug);
  return result;
}

/** Every item in a collection; the server asks Steam again rather than trusting the preview. */
export async function addCollection(slug: string, idOrUrl: string): Promise<OpResult> {
  const result = await addCollectionOp(await requireUser(), slug, idOrUrl);
  if (result.ok) refresh(slug);
  return result;
}

export async function removeMod(slug: string, workshopId: string): Promise<OpResult> {
  const result = await removeModOp(await requireUser(), slug, workshopId);
  if (result.ok) refresh(slug);
  return result;
}

export async function setModEnabled(slug: string, workshopId: string, enabled: boolean): Promise<OpResult> {
  const result = await setModEnabledOp(await requireUser(), slug, workshopId, enabled);
  if (result.ok) refresh(slug);
  return result;
}

export async function reorderMods(slug: string, workshopIds: string[]): Promise<OpResult> {
  const result = await reorderModsOp(await requireUser(), slug, workshopIds);
  if (result.ok) refresh(slug);
  return result;
}

/* Writing the list into the game's settings — the one action here that
   touches the node, and the one that takes a backup first. */
export async function applyMods(slug: string, options: { backup?: boolean } = {}): Promise<OpResult> {
  const result = await applyModsOp(await requireUser(), slug, options);
  if (result.ok) refresh(slug);
  return result;
}

/** What the node found inside the downloads. */
export async function refreshInstalled(slug: string): Promise<OpResult> {
  const result = await refreshInstalledOp(await requireUser(), slug);
  if (result.ok) refresh(slug);
  return result;
}

/* The Steam key is the workspace's, not one server's; it is set from
   this tab because this is where it is used. */

export async function setWorkshopKey(key: string): Promise<OpResult> {
  const result = await setWorkshopKeyOp(await requireUser(), key);
  if (result.ok) revalidatePath("/mods");
  return result;
}

// Refreshes either way: a key Steam stopped taking is a result the tab has to show.
export async function checkWorkshopKey(): Promise<OpResult> {
  const result = await checkWorkshopKeyOp(await requireUser());
  revalidatePath("/mods");
  return result;
}

export async function removeWorkshopKey(): Promise<OpResult> {
  const result = await removeWorkshopKeyOp(await requireUser());
  if (result.ok) revalidatePath("/mods");
  return result;
}
