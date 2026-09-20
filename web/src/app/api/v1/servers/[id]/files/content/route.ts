import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { readFileOp, writeFileOp } from "@/lib/file-ops";
import { actorOf, jsonBody, queryParam, reachCode, refusal, said } from "../../../../_ops";
import { resolveServer } from "../../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/servers/:id/files/content?path=server.properties

   A text file, as the Files page reads it: the node caps what it
   returns, and `truncated` says when it did. Worlds and binaries are
   not files this API reads; that is what backups are for. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.files.read", server.ownerId);

    const at = queryParam(req, "path");
    const result = await readFileOp(await actorOf(principal), server.slug, at);
    if (!result.ok) throw new PlatformError(reachCode(result.error), result.error ?? "could not read that file", { details: { path: at } });
    return ok({ server: server.slug, path: at, content: result.content, truncated: result.truncated, sizeBytes: result.sizeBytes });
  } catch (error) {
    return fail(error);
  }
}

/* PUT /api/v1/servers/:id/files/content?path=server.properties

   Body: `{ "content": "…" }`. The whole file, replaced; the game reads
   it at its next restart, as the message says. Recorded in the audit
   log like a save from the Files page. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 60);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.files.write", server.ownerId);

    const at = queryParam(req, "path");
    const body = await jsonBody<{ content: unknown }>(req);
    if (typeof body.content !== "string") throw new PlatformError("VALIDATION_FAILED", "content has to be text.");

    const result = await writeFileOp(await actorOf(principal), server.slug, at, body.content);
    if (!result.ok) refusal(result, reachCode(result.body), { path: at });
    return ok({ server: server.slug, path: at, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
