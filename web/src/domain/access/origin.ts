
/* Whether a request came from this panel's own pages.

   Next checks this for server actions and for nothing else. The terminal
   takes typing through route handlers, so it checks for itself, the same
   way: the Origin header's host has to be the host the request was for.
   A request with no Origin is refused — every browser sends one on a
   POST, and what does not is not a page of ours. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let sent: string;
  try {
    sent = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const forwarded = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = (forwarded || req.headers.get("host") || "").toLowerCase();
  return host.length > 0 && sent === host;
}
