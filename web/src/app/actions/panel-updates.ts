"use server";

import { revalidatePath } from "next/cache";
import { holds } from "@/domain/access/permissions";
import { requireUser } from "@/lib/auth";
import { checkForUpdates, recordPanelUpdateNews, updateCheckEnabled } from "@/lib/panel-update-ops";
import { requestPanelUpdateOp } from "@/lib/panel-self-update-ops";
import type { OpResult } from "@/lib/server-ops";

/* The button on the Updates page: ask now, whatever the clock says (but not twice in half a minute: panel-update-ops.ts). Owners and admins,
   like the page: whoever may upgrade a node may be told that it is behind. */
export async function checkUpdatesNow(): Promise<OpResult> {
  const user = await requireUser();
  if (!holds(user.role, "node.manage")) {
    return { ok: false, title: "Cannot check", body: "Checking for updates is for owners and admins.", code: "FORBIDDEN" };
  }
  if (!updateCheckEnabled()) {
    return {
      ok: false,
      title: "Update checks are off",
      body: "GEEBOARD_UPDATE_CHECK=off is set on this panel, so it asks nobody. Take the line out of deploy/panel/.env and restart the panel to turn them on.",
    };
  }
  const result = await checkForUpdates({ force: true });
  if (result.ran) await recordPanelUpdateNews();
  revalidatePath("/updates");
  if (!result.ran) return { ok: true, tone: "success", title: "Checked a moment ago", body: "It was asked less than half a minute ago; what is on the page is what it said." };
  if (!result.ok) return { ok: false, title: "Could not check", body: result.error ?? "The release file could not be read." };
  return {
    ok: true,
    tone: "success",
    title: result.changed ? "A release it did not know" : "Checked",
    body: `The newest release is ${result.latest}.`,
  };
}

/* The other button: upgrade. Owners only, with a fresh authenticator code; it writes a request that the machine's updater runs
   (lib/panel-self-update-ops.ts). */
export async function requestPanelUpdate(version: string, code: string): Promise<OpResult> {
  const result = await requestPanelUpdateOp(await requireUser(), String(version ?? ""), String(code ?? ""));
  if (result.ok) revalidatePath("/updates");
  return result;
}
