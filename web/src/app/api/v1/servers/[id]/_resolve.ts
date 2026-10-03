import "server-only";
import { PlatformError } from "@/domain/errors";
import { db } from "@/lib/db";

/* Finding a server by whatever the caller had to hand.

   Slugs are what a person types and what the panel's own URLs carry;
   ids are what a program stores. Accepting both costs one extra lookup
   and saves every client from having to know which it is holding. */
export async function resolveServer(idOrSlug: string) {
  const server = await db.server.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    // The DNS records come with it: the one-server route says whether players need the port, from them.
    include: { node: true, gameVersionRef: { select: { slug: true } }, dnsRecords: true },
  });

  if (!server) {
    throw new PlatformError("NOT_FOUND", "No server by that id.", { details: { server: idOrSlug } });
  }
  return server;
}
