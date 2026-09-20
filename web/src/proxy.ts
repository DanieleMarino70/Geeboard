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

export const config = {
  // Not the build's own files or the favicon: nothing there is worth an id.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
