import "server-only";
import { can } from "@/domain/access/permissions";
import { PlatformError } from "@/domain/errors";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";

/* Finding a server by whatever the caller had to hand.

   Slugs are what a person types and what the panel's own URLs carry;
   ids are what a program stores. Accepting both costs one extra lookup
   and saves every client from having to know which it is holding.

   A server the caller's role cannot read at all is not found: the same answer as one that is not there, so that a member (or a key made as one) cannot
   learn which names exist on the panel from the difference between 403 and 404 (the audit of 0.9.5; the pages have never said which slugs belong to
   other people). The role is asked and not the key's scopes: a key made for files only is not a key that sees no servers. */
export async function resolveServer(idOrSlug: string, caller?: { id: string; role: Role }) {
  const server = await db.server.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    // The DNS records come with it: the one-server route says whether players need the port, from them.
    include: { node: true, gameVersionRef: { select: { slug: true } }, dnsRecords: true },
  });

  if (!server || (caller && !can(caller, "server.read", server.ownerId))) {
    throw new PlatformError("NOT_FOUND", "No server by that id.", { details: { server: idOrSlug } });
  }
  return server;
}
