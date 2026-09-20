import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { downloadFileOp, uploadFileOp } from "@/lib/file-ops";
import { actorOf, queryParam, reachCode } from "../../../../_ops";
import { resolveServer } from "../../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/servers/:id/files/raw?path=plugins/essentials.jar

   The file's bytes, as `application/octet-stream`, streamed from the
   node through the panel without being held by either. `files/content`
   is for text a person edits and stops at 2 MB; this is for a program
   moving a file, and stops where the node does (256 MB). A world is
   still not something to fetch this way: that is what backups are. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 60);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.files.read", server.ownerId);

    const at = queryParam(req, "path");
    const file = await downloadFileOp(await actorOf(principal), server.slug, at);
    if (!file.ok) throw new PlatformError(reachCode(file.error), file.error, { details: { path: at } });

    return new Response(file.body, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        ...(Number.isFinite(file.sizeBytes) ? { "content-length": String(file.sizeBytes) } : {}),
        // Quoted and stripped: a file name is somebody's input, and this is a header.
        "content-disposition": `attachment; filename="${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return fail(error);
  }
}

/* PUT /api/v1/servers/:id/files/raw?path=plugins/essentials.jar

   The request body is the file: no JSON, no multipart. Written beside
   the target and renamed over it, so an upload that drops half-way
   leaves the file that was there. Replaces a file of the same name,
   makes missing directories, refuses a directory's own path and anything
   outside the server's directory. An audit entry, like a save. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 30);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.files.write", server.ownerId);

    const at = queryParam(req, "path");
    if (!req.body) throw new PlatformError("VALIDATION_FAILED", "The request body is the file, and there was none.");

    const result = await uploadFileOp(await actorOf(principal), server.slug, at, req.body);
    if (!result.ok) throw new PlatformError(reachCode(result.body), result.body, { details: { path: at } });
    return ok({ server: server.slug, path: result.entry!.path, sizeBytes: result.entry!.sizeBytes, message: `${result.title}. ${result.body}` }, 201);
  } catch (error) {
    return fail(error);
  }
}
