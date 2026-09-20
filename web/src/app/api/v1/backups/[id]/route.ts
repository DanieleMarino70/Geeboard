import { begin, fail, mustAllow, ok } from "@/lib/api";
import { deleteBackupOp } from "@/lib/backup-ops";
import { actorOf, refusal, said } from "../../_ops";
import { backupShape } from "../../_shape";
import { resolveBackup } from "../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/backups/:id */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req);
    const { id } = await ctx.params;
    const backup = await resolveBackup(id);
    mustAllow(principal, "server.backup.read", backup.ownerId);
    return ok(backupShape(backup));
  } catch (error) {
    return fail(error);
  }
}

/* DELETE /api/v1/backups/:id

   Removes the archive — from the node, or from the bucket — and the
   row. A locked backup is refused until it is unlocked. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 30);
    const { id } = await ctx.params;
    const backup = await resolveBackup(id);
    mustAllow(principal, "server.backup.write", backup.ownerId);

    const result = await deleteBackupOp(await actorOf(principal), backup.id);
    if (!result.ok) refusal(result, /locked/i.test(result.title) ? "CONFLICT" : "SERVER_STATE_INVALID", { backup: backup.id });
    return ok({ backup: backup.id, deleted: true, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
