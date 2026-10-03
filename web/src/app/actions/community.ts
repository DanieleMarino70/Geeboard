"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { approveManifestOp, rejectManifestOp, retireGameOp, setRegistriesOp, submitManifestOp, type CommunityResult } from "@/lib/community-games";

/* Thin, like the other action files: resolve the user, call the operation,
   revalidate what shows the result. Every one of these is an owner's or an
   admin's, checked in the operation, and none is reachable with an API key. */

function refresh() {
  revalidatePath("/games");
  revalidatePath("/games/community");
  revalidatePath("/servers/new");
  revalidatePath("/audit");
}

export async function proposeManifest(text: string): Promise<CommunityResult> {
  const result = await submitManifestOp(await requireUser(), String(text ?? ""));
  if (result.ok) refresh();
  return result;
}

export async function approveManifest(revisionId: string, input: { hash: string; code: string }): Promise<CommunityResult> {
  const result = await approveManifestOp(await requireUser(), String(revisionId ?? ""), { hash: String(input?.hash ?? ""), code: String(input?.code ?? "") });
  if (result.ok) {
    refresh();
    revalidatePath(`/games/community/${revisionId}`);
  }
  return result;
}

export async function rejectManifest(revisionId: string, note: string): Promise<CommunityResult> {
  const result = await rejectManifestOp(await requireUser(), String(revisionId ?? ""), String(note ?? ""));
  if (result.ok) {
    refresh();
    revalidatePath(`/games/community/${revisionId}`);
  }
  return result;
}

export async function retireGame(gameId: string): Promise<CommunityResult> {
  const result = await retireGameOp(await requireUser(), String(gameId ?? ""));
  if (result.ok) refresh();
  return result;
}

export async function saveRegistries(list: string[]): Promise<CommunityResult> {
  const result = await setRegistriesOp(await requireUser(), Array.isArray(list) ? list.map(String) : []);
  if (result.ok) refresh();
  return result;
}
