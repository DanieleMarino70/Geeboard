"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { setFlash } from "@/lib/flash";
import { deleteServerOp, updateServerSettingsOp, type OpResult } from "@/lib/server-ops";
import type { SettingsInput } from "@/lib/settings-rules";

export type SettingsState = OpResult | null;

/* Called with the values rather than as a form action. A form action
   resets the form when it finishes, so a save that was refused lost
   everything typed into it. */
export async function saveServerSettings(slug: string, input: SettingsInput) {
  const result = await updateServerSettingsOp(await requireUser(), slug, {
    name: String(input.name ?? ""),
    host: String(input.host ?? ""),
    memoryLimit: Number(input.memoryLimit),
    cpuLimit: Number(input.cpuLimit),
    // An unrecognised value falls back to the cautious policy rather than to whichever sorts first.
    restartPolicy: ["NEVER", "ALWAYS", "ON_FAILURE"].includes(input.restartPolicy) ? input.restartPolicy : "ON_FAILURE",
    maxRestarts: Number(input.maxRestarts),
  });
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

  const result = await deleteServerOp(await requireUser(), slug, confirmation, {
    finalBackup: formData.get("finalBackup") === "on",
    forget: formData.get("forget") === "on",
  });
  if (!result.ok) return result;

  revalidatePath("/");
  revalidatePath("/servers");
  revalidatePath("/backups");
  revalidatePath("/audit");
  /* The redirect discards the answer, and the answer is the part that matters: which final backup was taken and where it stays, and any
     DNS record that was left behind. The Servers page says it once. */
  await setFlash({ tone: result.tone, title: result.title, body: result.body });
  redirect("/servers");
}
