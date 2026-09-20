import { begin, fail, mustAllow, ok } from "@/lib/api";
import { restoreBackupOp } from "@/lib/backup-ops";
import { actorOf, refusal, said } from "../../../_ops";
import { resolveBackup } from "../../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/backups/:id/restore

   Destructive by design: the server is stopped, its directory replaced
   by the archive after the checksum is checked, and started again if it
   was running. No body, no confirmation string — a client that calls
   this has said which backup, which is the whole of the question. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 10);
    const { id } = await ctx.params;
    const backup = await resolveBackup(id);
    mustAllow(principal, "server.backup.write", backup.server.ownerId);

    const result = await restoreBackupOp(await actorOf(principal), backup.id);
    if (!result.ok) refusal(result, "SERVER_STATE_INVALID", { backup: backup.id, server: backup.server.slug });
    return ok({ backup: backup.id, server: backup.server.slug, message: said(result) }, 202);
  } catch (error) {
    return fail(error);
  }
}
