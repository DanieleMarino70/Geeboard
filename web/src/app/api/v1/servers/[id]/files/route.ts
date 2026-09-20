import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { deleteEntryOp, listFilesOp } from "@/lib/file-ops";
import { actorOf, reachCode, refusal, said } from "../../../_ops";
import { resolveServer } from "../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/servers/:id/files?path=/

   A directory inside the server's own directory, as the node lists it.
   Paths are resolved inside that root on the node and refused if they
   escape; the API adds nothing to that and takes nothing away. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.files.read", server.ownerId);

    const at = new URL(req.url).searchParams.get("path") ?? "/";
    const result = await listFilesOp(await actorOf(principal), server.slug, at);
    if (!result.ok) throw new PlatformError(reachCode(result.error), result.error ?? "could not list that directory", { details: { path: at } });
    return ok({ server: server.slug, path: result.path, entries: result.entries });
  } catch (error) {
    return fail(error);
  }
}

/* DELETE /api/v1/servers/:id/files?path=world/old.dat — a file or a directory. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 60);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.files.write", server.ownerId);

    const at = new URL(req.url).searchParams.get("path");
    if (!at) throw new PlatformError("VALIDATION_FAILED", "The path query parameter is required.");

    const result = await deleteEntryOp(await actorOf(principal), server.slug, at);
    if (!result.ok) refusal(result, reachCode(result.body), { path: at });
    return ok({ server: server.slug, path: at, deleted: true, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
