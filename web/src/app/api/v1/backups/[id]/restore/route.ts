import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { restoreBackupOp } from "@/lib/backup-ops";
import { actorOf, jsonBody, refusal, said } from "../../../_ops";
import { resolveBackup } from "../../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/backups/:id/restore

   Destructive by design: the server is stopped, its directory replaced
   by the archive after the checksum is checked, and started again if it
   was running. No confirmation string — a client that calls this has said
   which backup, which is the whole of the question.

   Optional body `{ "into": "<server id or slug>" }`: another server to
   restore into. Required for a backup whose own server has been deleted;
   allowed only for an off-site archive, and only into a server of the
   game it was taken from. The permission is checked on the backup here
   and on the target by the operation.

   Optional `"inPlace": true`: for a node with no room for two copies of the
   world. The default unpacks the archive beside the world and exchanges them
   only when the whole of it has been written, so a restore that fails leaves
   the world as it was; in place removes the world first, and a failure then
   leaves it incomplete. The refusal for lack of room says when it would help. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 10);
    const { id } = await ctx.params;
    const backup = await resolveBackup(id);
    mustAllow(principal, "server.backup.write", backup.ownerId);

    /* A body that is there has to be what it says. This read an invalid body, `{"into": ""}`, `{"into": null}` and `{"into": 123}` as "no into" and
       restored over the server the backup came from: a script that meant "into staging" with an unset variable replaced the live world with
       an older one, and the only thing between the two was a typo. */
    const body = await jsonBody<{ into: unknown; inPlace: unknown }>(req);
    if (Object.hasOwn(body, "into") && (typeof body.into !== "string" || body.into.trim() === "")) {
      throw new PlatformError("VALIDATION_FAILED", "into has to be the id or slug of a server, or left out to restore over the server the backup came from.", { details: { field: "into" } });
    }
    if (Object.hasOwn(body, "inPlace") && typeof body.inPlace !== "boolean") {
      throw new PlatformError("VALIDATION_FAILED", "inPlace has to be true or false.", { details: { field: "inPlace" } });
    }
    const into = typeof body.into === "string" ? body.into.trim() : undefined;

    const result = await restoreBackupOp(await actorOf(principal), backup.id, { into, inPlace: body.inPlace === true });
    if (!result.ok) {
      refusal(result, "SERVER_STATE_INVALID", { backup: backup.id, server: into ?? backup.server?.slug ?? null });
    }
    return ok({ backup: backup.id, server: into ?? backup.server?.slug ?? null, message: said(result) }, 202);
  } catch (error) {
    return fail(error);
  }
}
