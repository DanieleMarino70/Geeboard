import "server-only";
import { NextResponse } from "next/server";
import { asPlatformError } from "@/domain/errors";
import { currentRequestId, logger } from "./log";

/* How every API route answers.

   Apart from lib/api.ts because that file identifies callers, which
   means sessions and cookies, and the two routes a node agent calls —
   register and heartbeat — have no user to identify. Keeping them free
   of that import is also what lets verify:registration serve those
   routes to a real agent without Next running. */

/** Everything a client is ever told about a failure. */
export function fail(error: unknown): NextResponse {
  const platform = asPlatformError(error);
  // With a reference it has been logged already, where it was converted (lib/unexpected.ts).
  if (platform.code === "INTERNAL" && !platform.details?.reference) {
    // The cause is for the log, and only for the log — under the request's id, so it can be found.
    const cause = platform.cause ?? platform;
    logger.error("api request failed", {
      code: platform.code,
      cause: cause instanceof Error ? cause.message : String(cause),
      stack: cause instanceof Error ? cause.stack?.split("\n").slice(0, 6).join(" | ") : undefined,
    });
  }
  const requestId = currentRequestId();
  const headers: Record<string, string> = {};
  if (requestId) headers["x-request-id"] = requestId;
  // A database that is away passes: a client that retries is told when.
  if (platform.code === "DATABASE_UNAVAILABLE") headers["retry-after"] = "5";
  return NextResponse.json(platform.toBody(), {
    status: platform.status,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });
}

export function ok(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
