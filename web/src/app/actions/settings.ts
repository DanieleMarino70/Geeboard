"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  deleteServerOp,
  updateServerSettingsOp,
  type OpResult,
  type SettingsInput,
} from "@/lib/server-ops";

export type SettingsState = OpResult | null;

export async function saveServerSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const slug = String(formData.get("slug") ?? "");
  const input: SettingsInput = {
    name: String(formData.get("name") ?? ""),
    host: String(formData.get("host") ?? ""),
    motd: String(formData.get("motd") ?? ""),
    javaFlags: String(formData.get("javaFlags") ?? ""),
    memoryLimit: Number(formData.get("memoryLimit") ?? 0),
    cpuLimit: Number(formData.get("cpuLimit") ?? 0),
    autosave: formData.get("autosave") === "on",
    whitelist: formData.get("whitelist") === "on",
    autoRestart: formData.get("autoRestart") === "on",
  };

  const result = await updateServerSettingsOp(await requireUser(), slug, input);
  if (result.ok) {
    revalidatePath("/settings");
    revalidatePath("/audit");
    revalidatePath("/servers");
    revalidatePath(`/servers/${slug}`);
    revalidatePath("/");
  }
  return result;
}

export async function deleteServer(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const slug = String(formData.get("slug") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  const result = await deleteServerOp(await requireUser(), slug, confirmation);
  if (!result.ok) return result;

  revalidatePath("/");
  revalidatePath("/servers");
  revalidatePath("/audit");
  redirect("/servers");
}
