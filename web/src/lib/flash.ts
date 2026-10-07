import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { FLASH_COOKIE, FLASH_MAX_AGE_SECONDS, decodeFlash, encodeFlash, type Flash } from "@/domain/flash";

/* Set by a server action that is about to `redirect()`; read by the root layout, which hands it to the toast, and cleared by the client
   (clearFlash) once it is on screen: a cookie cannot be removed while a page is being rendered, only by an action or a route. */
export async function setFlash(flash: Omit<Flash, "id">): Promise<void> {
  (await cookies()).set(FLASH_COOKIE, encodeFlash(flash, randomUUID()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: FLASH_MAX_AGE_SECONDS,
  });
}

export async function readFlash(): Promise<Flash | null> {
  return decodeFlash((await cookies()).get(FLASH_COOKIE)?.value);
}
