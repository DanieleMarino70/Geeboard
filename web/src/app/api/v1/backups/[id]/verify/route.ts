import { begin, fail, mustAllow, ok } from "@/lib/api";
import { verifyBackupOp } from "@/lib/backup-ops";
import { db } from "@/lib/db";
import { actorOf } from "../../../_ops";
import { backupShape } from "../../../_shape";
import { resolveBackup } from "../../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/backups/:id/verify

   Reads the archive back where it lies — on its node, or pulled down
   from the bucket — and compares it with the checksum taken when it was
   written. Synchronous, and as slow as reading the archive is.

   A damaged archive is an answer, not an error: 200 with `intact: false`
   and the backup carrying `verifyError`. `checked: false` is the third
   case — the node or the bucket could not be reached, so nothing was
   learned and the backup is as it was. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 10);
    const { id } = await ctx.params;
    const backup = await resolveBackup(id);
    mustAllow(principal, "server.backup.write", backup.ownerId);

    const result = await verifyBackupOp(await actorOf(principal), backup.id);
    const after = await db.backup.findUniqueOrThrow({
      where: { id: backup.id },
      include: { server: { select: { slug: true } } },
    });
    const looked = after.verifiedAt !== null && after.verifiedAt.getTime() !== backup.verifiedAt?.getTime();

    return ok(
      { intact: result.ok, checked: looked, message: `${result.title}. ${result.body}`, backup: backupShape(after) },
      200,
    );
  } catch (error) {
    return fail(error);
  }
}
