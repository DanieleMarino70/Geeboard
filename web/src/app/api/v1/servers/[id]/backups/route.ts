import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { createBackupOp } from "@/lib/backup-ops";
import { db } from "@/lib/db";
import { actorOf, jsonBody, refusal, said } from "../../../_ops";
import { backupShape } from "../../../_shape";
import { resolveServer } from "../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/servers/:id/backups — newest first, failed ones included. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.backup.read", server.ownerId);

    const backups = await db.backup.findMany({
      where: { serverId: server.id },
      orderBy: { createdAt: "desc" },
      include: { server: { select: { slug: true } } },
    });
    return ok({ server: server.slug, backups: backups.map(backupShape) });
  } catch (error) {
    return fail(error);
  }
}

/* POST /api/v1/servers/:id/backups

   Body: `{ "store": "LOCAL" | "S3" }`, optional; absent, the archive
   stays on the node. Synchronous — the world is flushed, archived and,
   off-site, uploaded before this answers — and the same operation as
   "Back up now", so the game's own save command runs first. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 10);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.backup.write", server.ownerId);

    const body = await jsonBody<{ store: unknown }>(req);
    if (body.store !== undefined && body.store !== "LOCAL" && body.store !== "S3") {
      throw new PlatformError("VALIDATION_FAILED", "store has to be LOCAL or S3.");
    }

    const result = await createBackupOp(await actorOf(principal), server.slug, body.store ? { store: body.store } : {});
    if (!result.ok) refusal(result, /No off-site storage/.test(result.title) ? "VALIDATION_FAILED" : "SERVER_STATE_INVALID", { server: server.slug });

    const backup = await db.backup.findUniqueOrThrow({ where: { id: result.backupId! }, include: { server: { select: { slug: true } } } });
    return ok({ ...backupShape(backup), message: said(result) }, 201);
  } catch (error) {
    return fail(error);
  }
}
