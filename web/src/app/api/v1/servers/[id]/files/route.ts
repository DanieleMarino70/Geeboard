import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { deleteEntryOp, listFilesOp, moveEntryOp } from "@/lib/file-ops";
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
    if (!result.ok) throw new PlatformError(reachCode(result), result.error ?? "could not list that directory", { details: { path: at } });
    return ok({ server: server.slug, path: result.path, entries: result.entries });
  } catch (error) {
    return fail(error);
  }
}

/* PATCH /api/v1/servers/:id/files  { "from": "plugins/old.jar", "to": "plugins/disabled/old.jar" } — a new name, in the same folder or another
   one inside the server. A name that is taken is a 409, never a replacement (the agent's rename would have replaced it without a word). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 60);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.files.write", server.ownerId);

    const body = (await req.json().catch(() => null)) as { from?: unknown; to?: unknown } | null;
    if (!body || typeof body.from !== "string" || typeof body.to !== "string" || !body.from.trim() || !body.to.trim()) {
      throw new PlatformError("VALIDATION_FAILED", 'The body is { "from": "<path>", "to": "<path>" }, both inside the server.');
    }

    const result = await moveEntryOp(await actorOf(principal), server.slug, body.from, body.to);
    if (!result.ok) refusal(result, reachCode(result), { from: body.from, to: body.to });
    return ok({ server: server.slug, from: body.from, to: body.to, renamed: true, message: said(result) });
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
    if (!result.ok) refusal(result, reachCode(result), { path: at });
    return ok({ server: server.slug, path: at, deleted: true, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
