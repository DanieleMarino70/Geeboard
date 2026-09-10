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
    include: { node: true, gameVersionRef: { select: { slug: true } } },
  });

  if (!server) {
    throw new PlatformError("NOT_FOUND", "No server by that id.", { details: { server: idOrSlug } });
  }
  return server;
}
