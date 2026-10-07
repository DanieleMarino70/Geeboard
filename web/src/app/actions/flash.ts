"use server";

import { cookies } from "next/headers";
import { FLASH_COOKIE } from "@/domain/flash";

/** The one message that was carried over a redirect has been shown: it is not shown again on the next page. */
export async function clearFlash(): Promise<void> {
  (await cookies()).delete(FLASH_COOKIE);
}
