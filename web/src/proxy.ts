import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/* Every request gets an id before anything else sees it.

   It goes onto the request, where the pages, the actions and the API read
   it (src/lib/log.ts), and onto the response as `x-request-id`, so that
   somebody reporting "it said something went wrong" can be asked for the
   one string that finds the lines. An id a client sent is kept if it
   looks like one — a script correlating its own calls — and is never
   trusted for anything but a log line.

   Nothing else happens here. Signing in and the account gate are
   requireUser's, in the render, where they can read the database. */
export function proxy(request: NextRequest) {
  const given = request.headers.get("x-request-id");
  const requestId = given && /^[A-Za-z0-9._-]{8,64}$/.test(given) ? given : crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  return response;
}

/* Not the build's own files or the favicon: nothing there is worth an id.

   And not a file's bytes. For every request this runs on, Next.js keeps a
   copy of the body — up to 10 MB by default — and past that it does not
   fail: it ends the stream there. So every upload over 10 MB reached the
   node as its first 10 MB and was reported uploaded; a Terraria world
   failed to load days later. Raising the limit would hold whole uploads
   in memory for the sake of a log id, so the route is left out instead,
   and makes its own id (lib/log.ts). The node checks the size as well,
   so a cut like this is refused wherever it happens. */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/v1/servers/[^/]+/files/raw).*)"],
};
