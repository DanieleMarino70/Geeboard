import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { setBackupLockOp } from "@/lib/backup-ops";
import { actorOf, jsonBody, refusal, said } from "../../../_ops";
import { resolveBackup } from "../../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/backups/:id/lock — body `{ "locked": true | false }`.

   A locked backup is kept indefinitely and skipped by retention. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 60);
    const { id } = await ctx.params;
    const backup = await resolveBackup(id);
    mustAllow(principal, "server.backup.write", backup.server.ownerId);

    const body = await jsonBody<{ locked: unknown }>(req);
    if (typeof body.locked !== "boolean") throw new PlatformError("VALIDATION_FAILED", "locked has to be true or false.");

    const result = await setBackupLockOp(await actorOf(principal), backup.id, body.locked);
    if (!result.ok) refusal(result, "SERVER_STATE_INVALID", { backup: backup.id });
    return ok({ backup: backup.id, locked: body.locked, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
