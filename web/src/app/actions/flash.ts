"use server";

import { FLASH_COOKIE } from "@/domain/flash";
import { deletePanelCookie } from "@/lib/cookie-jar";

/** The one message that was carried over a redirect has been shown: it is not shown again on the next page. */
export async function clearFlash(): Promise<void> {
  await deletePanelCookie(FLASH_COOKIE);
}
