import { begin, fail, mustAllow, ok } from "@/lib/api";
import { restoreBackupOp } from "@/lib/backup-ops";
import { actorOf, refusal, said } from "../../../_ops";
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
   and on the target by the operation. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 10);
    const { id } = await ctx.params;
    const backup = await resolveBackup(id);
    mustAllow(principal, "server.backup.write", backup.ownerId);

    const body = (await req.json().catch(() => ({}))) as { into?: unknown };
    const into = typeof body.into === "string" && body.into.trim() ? body.into.trim() : undefined;

    const result = await restoreBackupOp(await actorOf(principal), backup.id, { into });
    if (!result.ok) {
      refusal(result, /which server|different game|Cannot restore there/i.test(result.title) ? "VALIDATION_FAILED" : "SERVER_STATE_INVALID", {
        backup: backup.id,
        server: into ?? backup.server?.slug ?? null,
      });
    }
    return ok({ backup: backup.id, server: into ?? backup.server?.slug ?? null, message: said(result) }, 202);
  } catch (error) {
    return fail(error);
  }
}
