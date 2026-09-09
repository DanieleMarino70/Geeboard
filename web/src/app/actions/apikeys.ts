"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  createApiKeyOp,
  deleteApiKeyOp,
  revokeApiKeyOp,
  type OpResult,
} from "@/lib/server-ops";

export type KeyState = (OpResult & { secret?: string }) | null;

function refresh() {
  revalidatePath("/api-keys");
  revalidatePath("/audit");
  revalidatePath("/members");
}

export async function createApiKey(_prev: KeyState, formData: FormData): Promise<KeyState> {
  const name = String(formData.get("name") ?? "");
  const scopes = formData.getAll("scopes").map(String);
  const r = await createApiKeyOp(await requireUser(), name, scopes);
  if (r.ok) refresh();
  return r;
}

export async function revokeApiKey(id: string): Promise<OpResult> {
  const r = await revokeApiKeyOp(await requireUser(), id);
  if (r.ok) refresh();
  return r;
}

export async function deleteApiKey(id: string): Promise<OpResult> {
  const r = await deleteApiKeyOp(await requireUser(), id);
  if (r.ok) refresh();
  return r;
}
