import "server-only";
import { db } from "./db";

/* The audit log outlives the servers it is about.

   An event keeps its link to a server while the server exists, so a
   rename shows on every line at once. When the server is deleted, the
   link goes — the relation sets it to null — and the server's id, name
   and slug are written onto its events first, in the same transaction as
   the delete. Deleting a server used to take every event about it along:
   the settings changed, the commands typed, the mods applied, and the
   steps of a create that failed, which is why the first failure of a
   large Zomboid image left nothing to read. */

/** Written onto a server's events just before it is deleted. For a `$transaction`, ahead of the delete. */
export function keepHistoryOf(server: { id: string; name: string; slug: string }) {
  return db.activityEvent.updateMany({
    where: { serverId: server.id },
    data: { originServerId: server.id, originServerName: server.name, originServerSlug: server.slug },
  });
}

export interface EventServer {
  name: string;
  /** Null for a server deleted before its slug was kept. */
  slug: string | null;
  deleted: boolean;
}

/** Which server an event was about: the live one, or what was written when it was deleted. */
export function serverOfEvent(event: {
  server?: { name: string; slug?: string } | null;
  originServerName: string | null;
  originServerSlug: string | null;
}): EventServer | null {
  if (event.server) return { name: event.server.name, slug: event.server.slug ?? null, deleted: false };
  if (event.originServerName) return { name: event.originServerName, slug: event.originServerSlug, deleted: true };
  return null;
}
