/* Which server an audit event was about. Pure, so that the API's shapes (app/api/v1/_shape.ts) can be built in a unit test without a
   database: lib/audit.ts, which writes the history this reads, re-exports it. */

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
