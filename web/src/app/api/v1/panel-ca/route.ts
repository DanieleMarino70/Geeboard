import { NextResponse } from "next/server";
import { panelAuthority } from "@/domain/access/panel-authority";
import { PlatformError } from "@/domain/errors";
import { fail } from "@/lib/api-response";

/* This panel's own certificate authority, for a node that is about to join.

   Public on purpose, and it has to be: the node asking has no token yet and does not trust the connection it asks over. What
   keeps that safe is that the node compares what it gets with the fingerprint in the command it was given, which came from the
   signed-in page; a certificate that does not match is thrown away. A root certificate is not a secret (see
   domain/access/panel-authority.ts). 404 when this panel has none: it is behind a name and a public authority, or it was
   installed before it learned its own, and the 404 is the API's own error, `{ code, message }`, like every other route's: it said
   `{ error }`, the one body in /api/v1 that was not. */
export const dynamic = "force-dynamic";

export function GET() {
  const authority = panelAuthority();
  if (!authority) {
    return fail(new PlatformError("NOT_FOUND", "This panel has no certificate authority of its own to offer."));
  }
  return new NextResponse(authority.pem, {
    headers: {
      "content-type": "application/x-pem-file",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
