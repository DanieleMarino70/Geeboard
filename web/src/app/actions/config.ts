"use server";

import { revalidatePath } from "next/cache";
import type { ConfigValue } from "@/domain/games/types";
import { requireUser } from "@/lib/auth";
import { updateServerConfigOp, type ConfigResult } from "@/lib/config-ops";

/* Thin, like the other action files: resolve the user, call the
   operation, revalidate what changed. */

export async function updateServerConfig(
  slug: string,
  values: Record<string, ConfigValue>,
  recreate = false,
): Promise<ConfigResult> {
  const result = await updateServerConfigOp(await requireUser(), slug, values, { recreate });
  if (result.ok) {
    revalidatePath("/settings");
    revalidatePath(`/servers/${slug}`);
    revalidatePath("/servers");
  }
  return result;
}
