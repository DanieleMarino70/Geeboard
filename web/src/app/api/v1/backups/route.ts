import { scopeOf } from "@/domain/access/permissions";
import { allows, begin, fail, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { backupShape } from "../_shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/backups?deleted=true

   The backups that have outlived their server: off-site archives of
   servers since deleted, which no `/servers/:id/backups` can list any
   more. Without `deleted=true` it is every backup the caller may read.

   Filtered rather than refused, like the server list: a member gets the
   backups of the servers they own or owned. */
export async function GET(req: Request) {
  try {
    const principal = await begin(req);
    const onlyDeleted = new URL(req.url).searchParams.get("deleted") === "true";

    /* The ownership filter is in the query, before the five hundred: it was applied after them, so a member's key lost its older backups when the
       workspace had five hundred newer ones that were not theirs. A role that reads every server's backups has no filter; one that reads its own has
       the servers it owns, and the off-site archives of servers it owned. */
    const own = scopeOf(principal.role, "server.backup.read") !== "all";
    const backups = await db.backup.findMany({
      where: {
        ...(onlyDeleted ? { serverId: null } : {}),
        ...(own ? { OR: [{ server: { ownerId: principal.id } }, { serverId: null, originOwnerId: principal.id }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { server: { select: { slug: true, ownerId: true } } },
      take: 500,
    });
    // What the key's own scopes allow is still asked, row by row.
    const readable = backups.filter((b) => allows(principal, "server.backup.read", b.server?.ownerId ?? b.originOwnerId));
    return ok({ backups: readable.map(backupShape) });
  } catch (error) {
    return fail(error);
  }
}
