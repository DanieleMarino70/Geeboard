import "server-only";
import { cookies, headers } from "next/headers";
import { cookieName, cookiesAreSecure, type CookieBase } from "@/domain/access/cookie-names";

/* The panel's own cookies, by the names this request gives them (domain/access/cookie-names.ts says why there are two). Every cookie the
   panel sets is HttpOnly, SameSite=Lax and has the path `/`; `__Host-` asks for the last, and for no Domain, which none of them has. */

export async function cookieSecurity(): Promise<boolean> {
  const h = await headers();
  return cookiesAreSecure({ production: process.env.NODE_ENV === "production", host: h.get("host"), forwardedProto: h.get("x-forwarded-proto") });
}

/** The name `base` has on this request. */
export async function panelCookieName(base: CookieBase): Promise<string> {
  return cookieName(base, await cookieSecurity());
}

export async function readPanelCookie(base: CookieBase): Promise<string | undefined> {
  return (await cookies()).get(await panelCookieName(base))?.value;
}

export async function setPanelCookie(base: CookieBase, value: string, maxAge: number): Promise<void> {
  const secure = await cookieSecurity();
  (await cookies()).set(cookieName(base, secure), value, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge });
}

/* With the attributes it was set with: a browser refuses the expired copy of a `__Host-` cookie that is not Secure, so a bare delete(name)
   would leave the session where it was. */
export async function deletePanelCookie(base: CookieBase): Promise<void> {
  const secure = await cookieSecurity();
  (await cookies()).delete({ name: cookieName(base, secure), httpOnly: true, sameSite: "lax", secure, path: "/" });
}

/* The unprefixed cookie 0.10 or before left, where this request uses the prefix. It is never read again; taken away so that it stops
   saying somebody was signed in. */
export async function dropLegacyCookie(base: CookieBase): Promise<void> {
  if (!(await cookieSecurity())) return;
  const jar = await cookies();
  // Secure, as a production panel set it: only ever asked where this request is secure.
  if (jar.has(base)) jar.delete({ name: base, path: "/", secure: true });
}

/** Whether the request carries the unprefixed cookie a release before 0.11 set, where it is no longer the one read. */
export async function hasLegacyCookie(base: CookieBase): Promise<boolean> {
  return (await cookieSecurity()) && (await cookies()).has(base);
}
