import { NextResponse } from "next/server";
import { panelAuthority } from "@/domain/access/panel-authority";

/* This panel's own certificate authority, for a node that is about to join.

   Public on purpose, and it has to be: the node asking has no token yet and does not trust the connection it asks over. What
   keeps that safe is that the node compares what it gets with the fingerprint in the command it was given, which came from the
   signed-in page; a certificate that does not match is thrown away. A root certificate is not a secret (see
   domain/access/panel-authority.ts). 404 when this panel has none: it is behind a name and a public authority, or it was
   installed before it learned its own. */
export const dynamic = "force-dynamic";

export function GET() {
  const authority = panelAuthority();
  if (!authority) {
    return NextResponse.json({ error: "This panel has no certificate authority of its own to offer." }, { status: 404 });
  }
  return new NextResponse(authority.pem, {
    headers: {
      "content-type": "application/x-pem-file",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
