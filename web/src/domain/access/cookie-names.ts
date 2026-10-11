/* What the panel's own cookies are called, and whether they are Secure.

   A cookie named `__Host-…` is one a browser keeps only when it is Secure, has the path `/` and names no domain, so nothing but this
   origin can have set it: a sibling subdomain that may set cookies for the whole domain (`Domain=.example.com`) cannot plant a session,
   a pending second step or a message of its own, as it could while they were plain `gb_session`, `gb_mfa` and `gb_flash` (the audit of
   0.9.5). Renaming a cookie signs everybody out once, which is why it was done before 1.0 (0.11.0); a panel rolled back to 0.10.1 reads
   `gb_session` again and signs everybody out once more.

   The prefix needs Secure, and a browser drops a Secure cookie that arrives over plain http — except on this machine: `localhost` and the
   loopback addresses are secure contexts to every current browser, http or not. So:

   - In production the cookies are Secure, as they were before 0.11 (env-check warns when PANEL_URL is not https), and always prefixed.
     The installer puts a panel behind Caddy with a certificate, a name's or its own, and publishes the plain-http port on the loopback
     address only; a production panel opened over plain http at a LAN address could not sign anybody in before this change either.
   - A development server (`next dev`) makes them Secure, and prefixed, where the browser is on a secure context: an https request, or
     this machine's own name or address. Opened at a LAN address over plain http — a phone on the Wi-Fi, looking at a developer's panel —
     it keeps the old names without Secure, because a Secure cookie there would never come back and nobody could sign in.

   The two names are never read for one another: a panel that read `gb_session` when `__Host-gb_session` was missing would take the very
   cookie the prefix is there to refuse. Two development panels on different ports of `localhost` still share their cookies (a cookie
   does not know the port), prefixed or not. */

export const COOKIE_BASES = ["gb_session", "gb_mfa", "gb_flash"] as const;
export type CookieBase = (typeof COOKIE_BASES)[number];

export const HOST_PREFIX = "__Host-";

export interface CookieRequest {
  production: boolean;
  /** The Host header, port and all. */
  host: string | null;
  /** X-Forwarded-Proto, when something in front of a development server says the browser used https. */
  forwardedProto: string | null;
}

/** This machine, as a browser counts it a secure context over plain http. */
export function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const bare = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.replace(/:\d+$/, "");
  const name = bare.toLowerCase();
  return name === "localhost" || name.endsWith(".localhost") || /^127(\.\d{1,3}){3}$/.test(name) || name === "::1";
}

export function cookiesAreSecure(request: CookieRequest): boolean {
  if (request.production) return true;
  if (request.forwardedProto?.split(",")[0]?.trim().toLowerCase() === "https") return true;
  return isLoopbackHost(request.host);
}

export function cookieName(base: CookieBase, secure: boolean): string {
  return secure ? `${HOST_PREFIX}${base}` : base;
}
