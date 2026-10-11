"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { setFlash } from "@/lib/flash";
import type { ConfigValue } from "@/domain/games/types";
import { deleteServerOp, type OpResult } from "@/lib/server-ops";
import type { SettingsInput } from "@/lib/settings-rules";
import { saveSettingsOp, type SaveResult } from "@/lib/settings-save";

export type SettingsState = OpResult | null;

function platformInput(input: SettingsInput): SettingsInput {
  return {
    name: String(input.name ?? ""),
    host: String(input.host ?? ""),
    memoryLimit: Number(input.memoryLimit),
    cpuLimit: Number(input.cpuLimit),
    // An unrecognised value falls back to the cautious policy rather than to whichever sorts first.
    restartPolicy: ["NEVER", "ALWAYS", "ON_FAILURE"].includes(input.restartPolicy) ? input.restartPolicy : "ON_FAILURE",
    maxRestarts: Number(input.maxRestarts),
  };
}

function revalidateServer(slug: string) {
  revalidatePath("/settings");
  revalidatePath("/audit");
  revalidatePath("/servers");
  revalidatePath(`/servers/${slug}`);
  revalidatePath("/");
}

/* The Settings page's one save bar: the game's settings and the server's own together, either part left out when it has not changed, and
   `rebuild` once the person has confirmed one (lib/settings-save.ts). Called with the values rather than as a form action: a form action
   resets the form when it finishes, so a save that was refused lost everything typed into it. */
export async function saveSettings(
  slug: string,
  request: { server?: SettingsInput; game?: Record<string, ConfigValue>; rebuild?: boolean },
): Promise<SaveResult> {
  const result = await saveSettingsOp(await requireUser(), slug, {
    server: request.server ? platformInput(request.server) : undefined,
    game: request.game && typeof request.game === "object" ? request.game : undefined,
    rebuild: request.rebuild === true,
  });
  // Written, whole or in part: the pages that show it are drawn again either way.
  if (result.ok || result.saved) revalidateServer(slug);
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
