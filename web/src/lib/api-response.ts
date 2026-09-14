import "server-only";
import { NextResponse } from "next/server";
import { asPlatformError } from "@/domain/errors";

/* How every API route answers.

   Apart from lib/api.ts because that file identifies callers, which
   means sessions and cookies, and the two routes a node agent calls —
   register and heartbeat — have no user to identify. Keeping them free
   of that import is also what lets verify:registration serve those
   routes to a real agent without Next running. */

/** Everything a client is ever told about a failure. */
export function fail(error: unknown): NextResponse {
  const platform = asPlatformError(error);
  if (platform.code === "INTERNAL") {
    // The cause is for the log, and only for the log.
    console.error("api:", platform.cause ?? platform);
  }
  return NextResponse.json(platform.toBody(), { status: platform.status });
}

export function ok(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
