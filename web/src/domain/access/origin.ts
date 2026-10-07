
/* Whether a request came from this panel's own pages.

   Next checks this for server actions and for nothing else. The terminal
   takes typing through route handlers, so it checks for itself, the same
   way: the Origin header's host has to be the host the request was for.
   A request with no Origin is refused — every browser sends one on a
   POST, and what does not is not a page of ours. */
/* The shape of a request this needs, so that the rule is testable without a Request. */
export interface RequestFacts {
  method: string;
  headers: { get(name: string): string | null; has(name: string): boolean };
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type CookieMutationProblem = { code: "FORBIDDEN" | "VALIDATION_FAILED"; message: string };

/* What a request that is authenticated by a cookie alone has to be, to change anything.

   A cookie goes along with every request a browser makes to this origin, whoever's page asked for it. An API key does
   not: a program has to choose to send it. So a request that carries only the cookie is the one a hostile page can cause,
   and it has to prove it is one of the panel's own: its Origin is this host (the check the terminal routes make), and a
   body is JSON, which a cross-origin form cannot send without the browser asking this panel's permission first. The panel's
   own pages use server actions, which Next checks the same way, so nothing in the product sends a cookie to a mutating
   /api/v1 route; this is for the one somebody scripts with a cookie they copied, and for the one a stranger's page tries.

   `rawBody` is for the route whose body is a file. Null is "fine". */
export function cookieMutationProblem(req: RequestFacts, options: { rawBody?: boolean } = {}): CookieMutationProblem | null {
  if (!MUTATING.has(req.method.toUpperCase())) return null;
  if (!sameOrigin(req as Request)) {
    return { code: "FORBIDDEN", message: "A request that changes something has to come from this panel's own pages, or carry an API key." };
  }
  const hasBody = req.headers.has("transfer-encoding") || (req.headers.get("content-length") ?? "0") !== "0";
  if (!options.rawBody && hasBody && !/^application\/json\s*(;|$)/i.test(req.headers.get("content-type") ?? "")) {
    return { code: "VALIDATION_FAILED", message: "The body has to be JSON, with Content-Type: application/json." };
  }
  return null;
}

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
