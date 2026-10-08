/* Where sign-in sends a person afterwards, and how it is carried there.

   A message that links to a page (a Discord post that says a server crashed, an email a person kept) lands on
   the panel signed out, and sign-in used to end at the dashboard, so the one thing the link was for was a
   second search away. The page asked for is carried through the sign-in and its second step as `next`.

   `next` comes from the address bar, so it is whatever anybody typed or sent. It is a path inside this panel
   or it is nothing: a scheme, a host, a protocol-relative `//`, a backslash that a browser reads as a slash,
   and a control character are all refused, and so is anywhere sign-in itself, the setup links and the API,
   which are not pages to go back to. A refused `next` is the dashboard, which is what sign-in did before.

   The guard looks at the path that will be sent, and not only at what was typed: `/.//evil.example` begins with one slash, and the URL
   parser collapses its dot-segment into `//evil.example`, which a browser reads as another host (the audit of 0.9.5). So a path with a
   dot-segment, spelled any way, is refused, and so is any result that begins with two slashes. */

/** The pages sign-in is made of, and what is not a page: nowhere to go back to. */
const NOT_A_PLACE = [/^\/$/, /^\/sign-in(\/|$)/, /^\/setup(\/|$)/, /^\/api(\/|$)/, /^\/_next(\/|$)/];

const BASE = "http://panel.invalid";

export function returnPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > 512) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  // A dot-segment, spelled with dots or with their percent-encoding, in the path (not in the query, where a dot is only a dot).
  const pathOnly = value.split(/[?#]/, 1)[0]!;
  if (pathOnly.split("/").some((segment) => /^(\.|%2e){1,2}$/i.test(segment))) return null;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  if (NOT_A_PLACE.some((pattern) => pattern.test(url.pathname))) return null;
  const path = url.pathname + url.search;
  if (path.startsWith("//")) return null;
  return path;
}

export interface SignInTarget {
  /** The page that was asked for, as the request saw it. */
  next?: string | null;
  /** The person had a session, and it is gone: expired, ended from another device, or reset by an admin. */
  ended?: boolean;
  /** An address to fill in, after a password was set. */
  email?: string | null;
}

/** The sign-in address for a person who has to sign in first. */
export function signInPath(target: SignInTarget = {}): string {
  const query = new URLSearchParams();
  const next = returnPath(target.next);
  if (next) query.set("next", next);
  if (target.ended) query.set("ended", "1");
  if (target.email && looksLikeEmail(target.email)) query.set("email", target.email);
  const text = query.toString();
  return text ? `/sign-in?${text}` : "/sign-in";
}

/* Enough of a shape to be put in a field, which is all it is: what a sign-in does with it is look it up. */
export function looksLikeEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(value);
}
